import * as d3 from 'd3'
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
	const graphsList = document.querySelector<HTMLUListElement>('#graphs')
	const chartTemplate = document.querySelector<HTMLTemplateElement>('#chart-template')
	const creatorTemplate = document.querySelector<HTMLTemplateElement>('#creator-template')
	const plotEmptyTemplate = document.querySelector<HTMLTemplateElement>('#plot-empty-template')
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
	let graphColumns: string[] = []
	let defaultX: string | null = null
	let defaultY: string | null = null

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
		if (display.slots[2] !== null) card.dataset.displayRows = '2'
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
		gallery.dataset.cardRows = display.slots[2] === null ? '1' : '2'
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

	type StatMode = 'medoid' | 'mean' | 'max' | 'min'
	const STAT_ORDER: StatMode[] = ['mean', 'max', 'min', 'medoid']
	const STAT_LABELS: Record<StatMode, string> = {
		medoid: 'Medoid',
		mean: 'Mean',
		max: 'Max',
		min: 'Min',
	}

	type StepStat = { x: number; mean: number; sd: number; max: number; min: number; medoid: number }

	const hasReportedSmilesError = (item: Entry) => {
		if (!smilesStateColumn) return false
		const state = (item.props[smilesStateColumn] ?? '').trim().toLowerCase()
		if (!state) return false
		return !['1', 'true', 'valid', 'success'].includes(state)
	}

	const hasInvalidSmiles = (item: Entry) => {
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

	const renderChart = (
		plot: HTMLElement,
		xCol: string,
		yCol: string,
		stat: StatMode,
		omitAllZerosInMin = false,
	) => {
		const rows: { x: number; y: number }[] = []
		for (const item of items) {
			const x = parseFloat((item.props[xCol] ?? '').trim())
			const y = parseFloat((item.props[yCol] ?? '').trim())
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue
			if (
				stat === 'min' &&
				y === 0 &&
				(omitAllZerosInMin || hasInvalidSmiles(item))
			)
				continue
			rows.push({ x, y })
		}
		if (rows.length === 0) {
			plot.replaceChildren(plotEmptyTemplate!.content.firstElementChild!.cloneNode(true))
			return
		}

		const byX = new Map<number, number[]>()
		for (const r of rows) {
			const arr = byX.get(r.x)
			if (arr) arr.push(r.y)
			else byX.set(r.x, [r.y])
		}
		const stats: StepStat[] = [...byX.entries()]
			.map(([x, ys]) => {
				const n = ys.length
				const mean = ys.reduce((s, v) => s + v, 0) / n
				const variance = ys.reduce((s, v) => s + (v - mean) ** 2, 0) / n
				const max = ys.reduce((s, v) => Math.max(s, v), -Infinity)
				const min = ys.reduce((s, v) => Math.min(s, v), Infinity)
				const sorted = [...ys].sort((a, b) => a - b)
				const mid = Math.floor(n / 2)
				const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
				const medoid = ys.reduce(
					(best, v) => (Math.abs(v - median) < Math.abs(best - median) ? v : best),
					ys[0],
				)
				return { x, mean, sd: Math.sqrt(Math.max(0, variance)), max, min, medoid }
			})
			.sort((a, b) => a.x - b.x)

		const statValue = (d: StepStat) => d[stat]

		const W = 360
		const H = 280
		const m = { top: 12, right: 18, bottom: 46, left: 58 }
		const iw = W - m.left - m.right
		const ih = H - m.top - m.bottom

		const x = d3
			.scaleLinear()
			.domain(d3.extent(stats, (d: StepStat) => d.x))
			.nice()
			.range([0, iw])
		const y = d3
			.scaleLinear()
			.domain([
				d3.min(stats, (d: StepStat) => statValue(d) - d.sd),
				d3.max(stats, (d: StepStat) => statValue(d) + d.sd),
			])
			.nice()
			.range([ih, 0])

		const svg = d3
			.create('svg')
			.attr('viewBox', `0 0 ${W} ${H}`)
			.attr('class', 'chart-root')
		const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`)

		g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6))
		g.append('g').call(d3.axisLeft(y).ticks(6))

		const band = d3
			.area()
			.x((d: StepStat) => x(d.x))
			.y0((d: StepStat) => y(statValue(d) - d.sd))
			.y1((d: StepStat) => y(statValue(d) + d.sd))
		g.append('path')
			.datum(stats)
			.attr('class', 'chart-band')
			.attr('d', band)

		const line = d3
			.line()
			.x((d: StepStat) => x(d.x))
			.y((d: StepStat) => y(statValue(d)))
		g.append('path')
			.datum(stats)
			.attr('class', 'chart-line')
			.attr('d', line)
		g.selectAll('circle')
			.data(stats)
			.join('circle')
			.attr('cx', (d: StepStat) => x(d.x))
			.attr('cy', (d: StepStat) => y(statValue(d)))
			.attr('class', 'chart-point')

		svg
			.append('text')
			.attr('x', m.left + iw / 2)
			.attr('y', H - 8)
			.attr('text-anchor', 'middle')
			.attr('data-axis-label', '')
			.text(xCol)
		svg
			.append('text')
			.attr('transform', 'rotate(-90)')
			.attr('x', -(m.top + ih / 2))
			.attr('y', 15)
			.attr('text-anchor', 'middle')
			.attr('data-axis-label', '')
			.text(yCol)

		const focus = g.append('g').attr('data-chart-hover', '').attr('data-visible', 'false')
		const crossV = focus
			.append('line')
			.attr('class', 'chart-crosshair')
		const crossH = focus
			.append('line')
			.attr('class', 'chart-crosshair')
		const hoverDot = focus
			.append('circle')
			.attr('class', 'chart-hover-point')

		const tip = svg.append('g').attr('data-chart-tip-box', '').attr('data-visible', 'false')
		const tipBg = tip
			.append('rect')
			.attr('class', 'chart-tooltip-bg')
		const tipText = tip.append('text').attr('data-chart-tip', '')

		const bisect = d3.bisector((d: StepStat) => d.x).center
		const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(3)))

		const overlay = g
			.append('rect')
			.attr('width', iw)
			.attr('height', ih)
			.attr('data-chart-overlay', '')

		const hideHover = () => {
			focus.attr('data-visible', 'false')
			tip.attr('data-visible', 'false')
		}
		overlay.on('mouseleave', hideHover)
		overlay.on('mousemove', (event: MouseEvent) => {
			const [mx] = d3.pointer(event)
			const d = stats[bisect(stats, x.invert(mx))] as StepStat | undefined
			if (!d || Math.abs(x(d.x) - mx) > 18) {
				hideHover()
				return
			}
			const sx = x(d.x)
			const sy = y(statValue(d))

			crossV.attr('x1', sx).attr('y1', sy).attr('x2', sx).attr('y2', ih)
			crossH.attr('x1', 0).attr('y1', sy).attr('x2', sx).attr('y2', sy)
			hoverDot.attr('cx', sx).attr('cy', sy)
			focus.attr('data-visible', 'true')

			tipText.selectAll('tspan').remove()
			tipText.append('tspan').attr('x', 6).attr('y', 13).text(`${xCol}: ${fmt(d.x)}`)
			tipText
				.append('tspan')
				.attr('x', 6)
				.attr('y', 25)
				.text(`${STAT_LABELS[stat]}: ${fmt(statValue(d))}`)
			tip.attr('data-visible', 'true')
			const bb = (tipText.node() as SVGTextElement).getBBox()
			const boxW = bb.width + 12
			const boxH = bb.height + 10
			tipBg.attr('width', boxW).attr('height', boxH)
			let gx = m.left + sx + 12
			let gy = m.top + sy - boxH - 8
			if (gx + boxW > W) gx = m.left + sx - boxW - 12
			if (gy < 0) gy = m.top + sy + 12
			tip.attr('transform', `translate(${gx},${gy})`)
		})

		plot.replaceChildren(svg.node())
	}

	const makeChart = (xCol: string, yCol: string, omitAllZerosInMin = false) => {
		const li = chartTemplate!.content.firstElementChild!.cloneNode(true) as HTMLLIElement
		li.dataset.x = xCol
		li.dataset.y = yCol
		li.dataset.statMode = 'mean'
		li.dataset.omitAllZerosInMin = String(omitAllZerosInMin)
		const title = `${yCol} vs ${xCol}`
		const titleEl = li.querySelector<HTMLElement>('[data-title]')!
		titleEl.textContent = title
		titleEl.title = title
		li.querySelector<HTMLButtonElement>('[data-remove]')?.addEventListener('click', () => {
			li.remove()
		})
		renderChart(
			li.querySelector<HTMLElement>('[data-plot]')!,
			xCol,
			yCol,
			'mean',
			omitAllZerosInMin,
		)
		return li
	}

	const fillAxisPills = (group: HTMLElement, selected: string | null) => {
		for (const c of graphColumns) {
			const pill = pillTemplate.content.firstElementChild!.cloneNode(true) as HTMLButtonElement
			pill.dataset.column = c
			pill.textContent = c
			const isSelected = c === selected
			if (isSelected) pill.dataset.slot = '0'
			pill.setAttribute('aria-pressed', String(isSelected))
			group.append(pill)
		}
	}

	const axisValue = (group: HTMLElement) =>
		group.querySelector<HTMLElement>('[data-slot]')?.dataset.column ?? null

	const refreshCreateBtn = (creator: HTMLElement) => {
		const y = axisValue(creator.querySelector<HTMLElement>('[data-y-axis]')!)
		const x = axisValue(creator.querySelector<HTMLElement>('[data-x-axis]')!)
		creator.querySelector<HTMLButtonElement>('[data-create]')!.disabled = !(x && y)
	}

	const makeCreator = () => {
		const li = creatorTemplate!.content.firstElementChild!.cloneNode(true) as HTMLLIElement
		fillAxisPills(li.querySelector<HTMLElement>('[data-y-axis]')!, defaultY)
		fillAxisPills(li.querySelector<HTMLElement>('[data-x-axis]')!, defaultX)
		refreshCreateBtn(li)
		return li
	}

	const buildGraphs = () => {
		if (!graphsList) return
		graphsList.replaceChildren()
		if (graphColumns.length === 0) return
		if (defaultX && defaultY) {
			const isDefaultScoreStep =
				reinventMode && normalizedColumn(defaultX) === 'step' && normalizedColumn(defaultY) === 'score'
			graphsList.append(makeChart(defaultX, defaultY, isDefaultScoreStep))
		}
		graphsList.append(makeCreator())
	}

	const findCol = (name: string) => graphColumns.find((c) => c.toLowerCase() === name) ?? null

	const setupGraphs = () => {
		const cols = items.length ? Object.keys(items[0].props) : []
		graphColumns = cols.filter((col) => {
			let any = false
			for (const item of items) {
				const v = (item.props[col] ?? '').trim()
				if (!v) continue
				if (!Number.isFinite(parseFloat(v))) return false
				any = true
			}
			return any
		})
		defaultX =
			(stepColumn && graphColumns.includes(stepColumn) ? stepColumn : findCol('step')) ??
			graphColumns[0] ??
			null
		defaultY = findCol('score') ?? graphColumns.find((c) => c !== defaultX) ?? graphColumns[0] ?? null
		buildGraphs()
	}

	graphsList?.addEventListener('click', (event) => {
		const target = event.target as HTMLElement

		const pill = target.closest<HTMLButtonElement>('[data-column]')
		if (pill) {
			const group = pill.closest<HTMLElement>('[data-x-axis], [data-y-axis]')!
			const wasSelected = pill.dataset.slot !== undefined
			group.querySelectorAll<HTMLElement>('[data-column]').forEach((p) => {
				delete p.dataset.slot
				p.setAttribute('aria-pressed', 'false')
			})
			if (!wasSelected) {
				pill.dataset.slot = '0'
				pill.setAttribute('aria-pressed', 'true')
			}
			refreshCreateBtn(pill.closest<HTMLElement>('[data-creator]')!)
			return
		}

		if (target.closest('[data-create]')) {
			const creator = target.closest<HTMLLIElement>('[data-creator]')!
			const x = axisValue(creator.querySelector<HTMLElement>('[data-x-axis]')!)
			const y = axisValue(creator.querySelector<HTMLElement>('[data-y-axis]')!)
			if (!x || !y) return
			creator.replaceWith(makeChart(x, y))
			graphsList!.append(makeCreator())
			return
		}

		const statBtn = target.closest<HTMLButtonElement>('button[data-stat]')
		if (statBtn) {
			const li = statBtn.closest<HTMLLIElement>('li')!
			const cur = (li.dataset.statMode as StatMode) ?? 'mean'
			const next = STAT_ORDER[(STAT_ORDER.indexOf(cur) + 1) % STAT_ORDER.length]
			li.dataset.statMode = next
			statBtn.textContent = STAT_LABELS[next]
			renderChart(
				li.querySelector<HTMLElement>('[data-plot]')!,
				li.dataset.x!,
				li.dataset.y!,
				next,
				li.dataset.omitAllZerosInMin === 'true',
			)
			return
		}

	})

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
		graphColumns = []
		buildGraphs()
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
		setupGraphs()
		applyView()
		recompute()
		columnsPanel.hidden = false
		renderBtn.disabled = false
		return true
	}

	form.addEventListener('submit', async (event) => {
		event.preventDefault()
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
		graphColumns = []
		view = 'viewer'
		buildGraphs()
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
