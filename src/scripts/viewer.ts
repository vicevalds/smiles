import type { ChartEntry } from './lib/line-chart'
import { bindGraphs } from './lib/graphs'
import { bindColumnFilters } from './lib/column-filters'
import { parseDelimitedLine, readRows } from './lib/csv'
import { bindDisplayValues } from './lib/display-values'
import { isAllowedFile, MAX_FILE_SIZE } from './lib/files'
import { createRDKitLoader, requestIdle, type RDKitModule } from './lib/rdkit'
import { bindHorizontalArrows, createCopyHandler, createMessageController, restrictToDigits, setCardText, setCopyButton } from './lib/dom'
import { createStatusController } from './lib/status'
import {
	MOLECULAR_MASS_COLUMN,
	MolecularMassResolver,
	withMolecularMassColumn,
} from './lib/molecular-mass'
import { getSharedViewerInput, setSharedViewerInput } from './lib/viewer-input'

const initializeViewer = () => {
	const viewerRoot = document.querySelector<HTMLElement>('[data-viewer-mode]')
	if (!viewerRoot) return

	const form = document.querySelector<HTMLFormElement>('#smiles-form')!
	const textarea = document.querySelector<HTMLTextAreaElement>('#smiles-text')!
	const fileInput = document.querySelector<HTMLInputElement>('#smiles-file')!
	const renderBtn = document.querySelector<HTMLButtonElement>('#render-btn')!
	const formError = document.querySelector<HTMLParagraphElement>('#form-error')!
	const formStatus = document.querySelector<HTMLParagraphElement>('#form-status')!
	const gallery = document.querySelector<HTMLUListElement>('#gallery')!
	const renderSummary = document.querySelector<HTMLParagraphElement>('#render-summary')!
	const summaryRendered = renderSummary.querySelector<HTMLElement>('[data-rendered]')!
	const renderTotal = document.querySelector<HTMLParagraphElement>('#render-total')!
	const totalRendered = renderTotal.querySelector<HTMLElement>('[data-total-rendered]')!
	const columns = document.querySelector<HTMLInputElement>('#columns')!
	const columnsValue = document.querySelector<HTMLSpanElement>('#columns-value')!
	const columnsPanel = document.querySelector<HTMLElement>('#columns-panel')!
	const cardTemplate = document.querySelector<HTMLTemplateElement>('#card-template')!
	const pillTemplate = document.querySelector<HTMLTemplateElement>('#pill-template')!
	const displayPanel = document.querySelector<HTMLDivElement>('#display-panel')!
	const columnFiltersPanel = document.querySelector<HTMLDivElement>('#column-filters')
	const setIdPanel = document.querySelector<HTMLDivElement>('#set-id')
	const setIdSelect = document.querySelector<HTMLSelectElement>('#set-id-column')
	const viewToggle = document.querySelector<HTMLElement>('#view-toggle')
	const gallerySection = document.querySelector<HTMLElement>('#gallery-section')!
	const graphsSection = document.querySelector<HTMLElement>('#graphs-section')
	const stepSlicer = document.querySelector<HTMLDivElement>('#step-slicer')!
	const stepRange = document.querySelector<HTMLInputElement>('#step-range')!
	const stepInput = document.querySelector<HTMLInputElement>('#step-input')!
	const stepTotal = document.querySelector<HTMLSpanElement>('#step-total')

	const reinventMode = viewerRoot.dataset.viewerMode === 'reinvent'
	const { show: showStatus, clear: clearStatus } = createStatusController(formStatus)
	const { show: showError, clear: clearError } = createMessageController(formError)

	const ALLOWED_EXTENSIONS = reinventMode
		? ['.csv', '.tsv']
		: ['.smi', '.smiles', '.csv', '.tsv']

	const applyColumns = () => {
		gallery.dataset.columns = columns.value
		columnsValue.textContent = columns.value
	}
	columns.addEventListener('input', applyColumns)

	const loadRDKit = createRDKitLoader({
		onStatus: (message) => showStatus(message),
		onReady: () => {
			renderBtn.disabled = false
		},
	})
	requestIdle(() => {
		void loadRDKit().catch((error) => {
			renderBtn.disabled = false
			showError(error instanceof Error ? error.message : 'RDKit failed to load.')
			clearStatus()
		})
	})

	type Entry = { smiles: string; id: string; props: Record<string, string> }
	type Parsed = { entries: Entry[]; columns: string[]; stepColumn: string | null }

	const normalizedColumn = (column: string) => column.replace(/^\uFEFF/, '').trim().toLowerCase()

	const parseInput = (text: string): Parsed => {
		const lines = readRows(text)
		if (lines.length === 0) return { entries: [], columns: [], stepColumn: null }

		const delimiter = lines[0].includes('\t') ? '\t' : ','
		const header = parseDelimitedLine(lines[0], delimiter)
		const lower = header.map(normalizedColumn)
		const smilesIdx = lower.indexOf('smiles')
		const isTabular = smilesIdx !== -1

		if (!isTabular) {
			const entries = lines.map((line) => {
				const [smiles, ...rest] = line.split(/\s+/)
				return { smiles, id: rest.join(' '), props: {} }
			})
			return { entries, columns: [], stepColumn: null }
		}

		const idIdx = lower.indexOf('id')
		const stepIdx = reinventMode ? lower.indexOf('step') : -1
		const stepColumn = stepIdx === -1 ? null : header[stepIdx]
		const propIdx = header.map((_, i) => i).filter((i) => i !== smilesIdx)
		const columns = propIdx.filter((i) => i !== stepIdx).map((i) => header[i])

		const entries: Entry[] = []
		for (let r = 1; r < lines.length; r++) {
			const cells = parseDelimitedLine(lines[r], delimiter)
			const smiles = cells[smilesIdx]
			if (!smiles) continue
			const props: Record<string, string> = {}
			for (const i of propIdx) props[header[i]] = cells[i] ?? ''
			entries.push({ smiles, id: idIdx === -1 ? '' : (cells[idIdx] ?? ''), props })
		}
		return { entries, columns, stepColumn }
	}

	let items: Entry[] = []
	let renderGeneration = 0
	let selectedIdColumn: string | null = null

	let rdkitModule: RDKitModule | null = null
	const svgCache = new Map<string, string>()
	const smilesValidityCache = new Map<string, boolean>()
	const molecularMass = new MolecularMassResolver()
	const SVG_CACHE_CAP = 800
	const generateSvg = (index: number): string => {
		const smiles = items[index].smiles
		const cached = svgCache.get(smiles)
		if (cached !== undefined) {
			svgCache.delete(smiles)
			svgCache.set(smiles, cached)
			return cached
		}
		let svg = ''
		if (rdkitModule) {
			const mol = rdkitModule.get_mol(smiles)
			try {
				const isValid = !!mol?.is_valid()
				smilesValidityCache.set(smiles, isValid)
				if (isValid) {
					svg = mol.get_svg(300, 300)
					try {
						molecularMass.cacheDescriptors(smiles, mol.get_descriptors())
					} catch {
						molecularMass.cacheDescriptors(smiles, '')
					}
				} else molecularMass.cacheDescriptors(smiles, '')
			} finally {
				mol?.delete()
			}
		}
		svgCache.set(smiles, svg)
		if (svgCache.size > SVG_CACHE_CAP) {
			const oldest = svgCache.keys().next().value
			if (oldest !== undefined) svgCache.delete(oldest)
		}
		return svg
	}
	let stepColumn: string | null = null
	let smilesStateColumn: string | null = null
	let steps: string[] = []
	let currentStepIndex = 0

	let view: 'viewer' | 'graphs' = 'viewer'

	const displayValue = (item: Entry, column: string, resolveComputed = true) =>
		column === MOLECULAR_MASS_COLUMN
			? (resolveComputed ? molecularMass.get(item.smiles, rdkitModule) : '')
			: (item.props[column] ?? '')

	const formattedDisplayValue = (item: Entry, column: string, resolveComputed = true) => {
		const value = displayValue(item, column, resolveComputed)
		return value && column === MOLECULAR_MASS_COLUMN ? `${value} Da` : value
	}
	const display = bindDisplayValues(displayPanel, pillTemplate, () => recompute())
	const columnFilters = bindColumnFilters(columnFiltersPanel, () => recompute(), displayValue)

	const cardId = (item: Entry) => selectedIdColumn
		? (item.props[selectedIdColumn] ?? '')
		: Object.keys(item.props).length === 0 ? item.id : ''

	const setCardValues = (card: HTMLLIElement, item: Entry, resolveComputed = true) => {
		const values = display.slots.map((column) =>
			column ? formattedDisplayValue(item, column, resolveComputed) : '',
		)
		values[0] ||= (reinventMode ? '' : item.id) || item.smiles
		setCardText(card, values, true)
	}

	const buildCard = (index: number) => {
		const item = items[index]
		const card = cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement
		card.dataset.displayRows = display.rowCount
		card.setAttribute('aria-busy', 'true')
		const svgEl = card.querySelector<HTMLElement>('[data-svg]')
		if (svgEl) {
			svgEl.setAttribute('aria-label', 'Molecule rendering pending')
		}
		card.dataset.itemIndex = String(index)
		card.dataset.lazy = 'true'
		const id = cardId(item)
		setCopyButton(card, '[data-copy-smiles]', item.smiles, 'Copy SMILES')
		setCopyButton(card, '[data-copy-id]', id, `Copy ID: ${id}`)
		setCardValues(card, item, false)
		return card
	}

	type LazyCard = { card: HTMLLIElement; index: number; version: number }

	let galleryVersion = 0
	let lazyCards: LazyCard[] = []
	let lazyFlushScheduled = false

	const distanceFromViewport = ({ card }: LazyCard) => {
		const rect = card.getBoundingClientRect()
		if (rect.bottom < 0) return -rect.bottom
		if (rect.top > window.innerHeight) return rect.top - window.innerHeight
		return 0
	}

	const hydrateCard = ({ card, index, version }: LazyCard) => {
		if (version !== galleryVersion || !card.isConnected) return
		const svgEl = card.querySelector<HTMLElement>('[data-svg]')
		if (!svgEl) return

		const svg = generateSvg(index)
		setCardValues(card, items[index])
		svgEl.removeAttribute('aria-label')
		if (svg) svgEl.innerHTML = svg
		card.removeAttribute('aria-busy')
		delete card.dataset.lazy
		delete card.dataset.queued
	}

	const flushLazyCards = (deadline?: IdleDeadline) => {
		lazyFlushScheduled = false
		const started = performance.now()
		let rendered = 0

		while (lazyCards.length > 0) {
			if (cardObserver) {
				lazyCards.sort((a, b) => distanceFromViewport(a) - distanceFromViewport(b))
			}
			const next = lazyCards.shift()!
			hydrateCard(next)
			rendered++

			if (
				rendered >= 3 ||
				performance.now() - started >= 18 ||
				(deadline && !deadline.didTimeout && deadline.timeRemaining() < 3)
			) break
		}

		if (lazyCards.length > 0) scheduleLazyFlush()
	}

	const scheduleLazyFlush = () => {
		if (lazyFlushScheduled) return
		lazyFlushScheduled = true
		if (window.requestIdleCallback) {
			window.requestIdleCallback(flushLazyCards, { timeout: 80 })
		} else window.setTimeout(() => flushLazyCards(), 16)
	}

	const enqueueCard = (card: HTMLLIElement) => {
		if (card.dataset.queued === 'true' || card.dataset.lazy !== 'true') return
		const index = Number(card.dataset.itemIndex)
		if (!Number.isInteger(index)) return
		card.dataset.queued = 'true'
		lazyCards.push({ card, index, version: galleryVersion })
		scheduleLazyFlush()
	}

	const cardObserver = typeof IntersectionObserver === 'undefined'
		? null
		: new IntersectionObserver((entries, observer) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue
				const card = entry.target as HTMLLIElement
				observer.unobserve(card)
				enqueueCard(card)
			}
		}, { rootMargin: '700px 0px' })

	gallery.addEventListener('click', createCopyHandler())
	gallery.addEventListener('camera:hydrate', (event) => {
		for (const card of (event as CustomEvent<HTMLLIElement[]>).detail) {
			if (card.dataset.lazy === 'true') hydrateCard({ card, index: Number(card.dataset.itemIndex), version: galleryVersion })
		}
	})

	const computeOrder = (): number[] => {
		const base = items.map((_, i) => i)
		const col = display.sortedColumn
		if (!col) return base
		const raw = (i: number) => displayValue(items[i], col).trim()
		const numeric = base.every((i) => raw(i) === '' || Number.isFinite(parseFloat(raw(i))))
		const dir = display.sortDirection === 'desc' ? 1 : -1
		return base.sort((a, b) => {
			const va = raw(a)
			const vb = raw(b)
			if (va === '' || vb === '') return va === vb ? a - b : va === '' ? 1 : -1
			const c = numeric ? parseFloat(va) - parseFloat(vb) : va.localeCompare(vb)
			return c === 0 ? a - b : -c * dir
		})
	}

	let activeOrder: number[] = []

	const stepActive = () => reinventMode && !!stepColumn && steps.length > 0
	const itemInStep = (i: number) =>
		!stepActive() || items[i].props[stepColumn!] === steps[currentStepIndex]
	const hasValidSmilesState = (i: number) =>
		!!smilesStateColumn && (items[i].props[smilesStateColumn] ?? '').trim() === '1'

	const renderGallery = () => {
		galleryVersion++
		gallery.dataset.cardRows = display.rowCount
		lazyCards = []
		cardObserver?.disconnect()
		const fragment = document.createDocumentFragment()
		const cards: HTMLLIElement[] = []
		for (const index of activeOrder) {
			const card = buildCard(index)
			cards.push(card)
			fragment.append(card)
		}
		gallery.replaceChildren(fragment)
		for (const card of cards) {
			if (cardObserver) cardObserver.observe(card)
			else enqueueCard(card)
		}
	}

	const recompute = () => {
		activeOrder = computeOrder()
			.filter(itemInStep)
			.filter((index) => columnFilters.matches(items[index]))
		if (stepActive()) {
			stepInput.value = String(currentStepIndex + 1)
			setSummary(activeOrder.filter(hasValidSmilesState).length)
		} else if (reinventMode) {
			setSummary(activeOrder.filter(hasValidSmilesState).length)
		} else setSummary(activeOrder.length)
		if (reinventMode && items.length > 0) renderSummary.hidden = false
		renderGallery()
	}

	const populateSetId = (columns: string[]) => {
		selectedIdColumn = null
		if (!setIdPanel || !setIdSelect) return
		setIdSelect.replaceChildren(new Option('', ''))
		for (const column of [...new Set(columns.filter(Boolean))]) {
			setIdSelect.append(new Option(column, column))
		}
		setIdPanel.hidden = columns.length === 0
	}

	setIdSelect?.addEventListener('change', () => {
		selectedIdColumn = setIdSelect.value || null
		recompute()
	})

	const populatePanel = (cols: string[], includeMolecularMass = false) => {
		display.populate(includeMolecularMass ? withMolecularMassColumn(cols) : cols)
		displayPanel.hidden = view === 'graphs' || !display.hasColumns
	}

	const setSummary = (rendered: number) => {
		summaryRendered.textContent = String(rendered)
		renderSummary.hidden = rendered === 0
	}

	const setTotals = (rendered: number) => {
		totalRendered.textContent = String(rendered)
		renderTotal.hidden = rendered === 0
	}

	stepRange.addEventListener('input', () => {
		currentStepIndex = Number(stepRange.value)
		recompute()
	})

	restrictToDigits(stepInput)
	stepInput.addEventListener('change', () => {
		if (steps.length === 0) return
		const next = Number(stepInput.value)
		if (!Number.isFinite(next)) {
			stepInput.value = String(currentStepIndex + 1)
			return
		}
		currentStepIndex = Math.min(Math.max(1, next), steps.length) - 1
		stepRange.value = String(currentStepIndex)
		recompute()
	})

	bindHorizontalArrows((direction) => {
		if (!stepActive()) return false
		const nextStepIndex = Math.min(Math.max(currentStepIndex + direction, 0), steps.length - 1)
		if (nextStepIndex === currentStepIndex) return false
		currentStepIndex = nextStepIndex
		stepRange.value = String(nextStepIndex)
		recompute()
		return true
	})

	const setupStepSlicer = () => {
		steps = []
		if (stepTotal) stepTotal.textContent = '0'
		if (!reinventMode || !stepColumn) {
			stepSlicer.hidden = true
			return
		}
		const seen = new Set<string>()
		for (const item of items) if (item.props[stepColumn]) seen.add(item.props[stepColumn])
		steps = [...seen].sort((a, b) => Number(a) - Number(b))
		if (steps.length === 0) {
			stepSlicer.hidden = true
			return
		}
		stepRange.max = String(steps.length - 1)
		stepRange.value = '0'
		stepRange.disabled = false
		stepInput.value = '1'
		stepInput.disabled = false
		if (stepTotal) stepTotal.textContent = String(steps.length)
		stepSlicer.hidden = false
		currentStepIndex = 0
	}

	const hasReportedSmilesError = (item: ChartEntry) => {
		if (!smilesStateColumn) return false
		const state = (item.props[smilesStateColumn] ?? '').trim().toLowerCase()
		if (!state) return false
		return !['1', 'true', 'valid', 'success'].includes(state)
	}

	const hasInvalidSmiles = (item: ChartEntry) => {
		if (hasReportedSmilesError(item)) return true
		const cached = smilesValidityCache.get(item.smiles)
		if (cached !== undefined) return !cached
		if (!rdkitModule) return false

		let mol: ReturnType<RDKitModule['get_mol']> = null
		try {
			mol = rdkitModule.get_mol(item.smiles)
			const isValid = !!mol?.is_valid()
			smilesValidityCache.set(item.smiles, isValid)
			return !isValid
		} catch {
			smilesValidityCache.set(item.smiles, false)
			return true
		} finally {
			mol?.delete()
		}
	}

	const graphs = bindGraphs<Entry>({ reinventMode, displayValue, hasInvalidSmiles })

	const applyView = () => {
		const graphs = view === 'graphs'
		viewToggle?.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
			button.setAttribute('aria-pressed', String(button.dataset.view === view))
		})
		if (graphsSection) graphsSection.hidden = !graphs
		gallerySection.hidden = graphs
		displayPanel.hidden = graphs || !display.hasColumns
	}

	viewToggle?.addEventListener('click', (event) => {
		const button = (event.target as Element).closest<HTMLButtonElement>('[data-view]')
		if (!button) return
		view = button.dataset.view === 'graphs' ? 'graphs' : 'viewer'
		applyView()
	})

	const showPlaceholders = () => {
		setSummary(0)
		setTotals(0)
		stepInput.value = '1'
		stepInput.disabled = true
		stepRange.max = '0'
		stepRange.value = '0'
		stepRange.disabled = true
		if (stepTotal) stepTotal.textContent = '0'
		stepSlicer.hidden = true
		populatePanel([])
		columnFilters.populate([])
		populateSetId([])
		applyView()
	}

	const hidePlaceholders = () => {
		renderSummary.hidden = true
		renderTotal.hidden = true
		stepSlicer.hidden = true
		populatePanel([])
		columnFilters.populate([])
		populateSetId([])
		applyView()
	}

	const renderInput = async (text: string) => {
		gallery.dispatchEvent(new Event('camera:reset'))
		const generation = ++renderGeneration
		renderBtn.disabled = true
		const parsed = parseInput(text)
		stepColumn = parsed.stepColumn
		gallery.replaceChildren()
		items = []
		activeOrder = []
		svgCache.clear()
		smilesValidityCache.clear()
		molecularMass.clear()
		smilesStateColumn = null
		steps = []
		currentStepIndex = 0
		stepSlicer.hidden = true
		setSummary(0)
		setTotals(0)
		populatePanel([])
		columnFilters.populate([])
		populateSetId([])
		graphs.clear()
		applyView()

		if (parsed.entries.length === 0) {
			renderBtn.disabled = false
			return false
		}

		let rdkit: RDKitModule
		try {
			rdkit = await loadRDKit()
		} catch {
			if (generation === renderGeneration) {
				showError('Failed to load the rendering engine. Check your connection and try again.')
			}
			renderBtn.disabled = false
			return false
		}
		if (generation !== renderGeneration) {
			renderBtn.disabled = false
			return false
		}

		rdkitModule = rdkit
		svgCache.clear()
		smilesValidityCache.clear()

		items = parsed.entries
		smilesStateColumn =
			Object.keys(items[0]?.props ?? {}).find(
				(column) => column.toLowerCase() === 'smiles_state',
			) ?? null
		setSummary(items.length)
		setTotals(items.length)
		renderSummary.hidden = !reinventMode

		populatePanel(parsed.columns, true)
		columnFilters.populate(withMolecularMassColumn(parsed.columns))
		populateSetId(parsed.columns)
		setupStepSlicer()
		graphs.populate(items, stepColumn)
		applyView()
		recompute()
		columnsPanel.hidden = false
		renderBtn.disabled = false
		return true
	}

	form.addEventListener('submit', async (event) => {
		event.preventDefault()
		form.dispatchEvent(new CustomEvent('viewer:clean'))
		const generation = renderGeneration
		renderBtn.disabled = true
		clearError()

		let text = textarea.value
		const file = fileInput.files?.[0]
		if (file) {
			if (!isAllowedFile(file, ALLOWED_EXTENSIONS)) {
				showError(`Allowed files: ${ALLOWED_EXTENSIONS.join(', ')}`)
				fileInput.value = ''
				renderBtn.disabled = false
				return
			}
			if (file.size > MAX_FILE_SIZE) {
				showError('File too large (max 20 MB).')
				fileInput.value = ''
				renderBtn.disabled = false
				return
			}
			text += '\n' + (await file.text())
		}
		if (generation !== renderGeneration) return

		if (await renderInput(text)) setSharedViewerInput(text)
	})

	form.addEventListener('viewer:clean', () => {
		gallery.dispatchEvent(new Event('camera:reset'))
		renderGeneration++
		galleryVersion++
		lazyCards = []
		cardObserver?.disconnect()
		gallery.replaceChildren()
		items = []
		activeOrder = []
		svgCache.clear()
		smilesValidityCache.clear()
		molecularMass.clear()
		stepColumn = null
		smilesStateColumn = null
		steps = []
		currentStepIndex = 0
		view = 'viewer'
		graphs.clear()
		columnsPanel.hidden = true
		clearError()
		clearStatus()
		if (reinventMode) showPlaceholders()
		else hidePlaceholders()
		renderBtn.disabled = false
	})

	if (reinventMode) showPlaceholders()
	else hidePlaceholders()

	const sharedInput = getSharedViewerInput()
	if (sharedInput) {
		textarea.value = sharedInput
		void renderInput(sharedInput)
	}
}

document.addEventListener('astro:page-load', initializeViewer)

export {}
