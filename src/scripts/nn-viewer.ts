import { bindColumnFilters } from './lib/column-filters'
import { parseDelimitedLine, readRows } from './lib/csv'
import { bindDisplayValues } from './lib/display-values'
import { formatMB, isAllowedFile, MAX_FILE_SIZE, readTextInput } from './lib/files'
import { createRDKitLoader, requestIdle, type RDKitModule } from './lib/rdkit'
import {
	bindHorizontalArrows,
	createCopyHandler,
	createMessageController,
	restrictToDigits,
	setCardText,
	setCopyButton,
} from './lib/dom'
import { createStatusController } from './lib/status'
import {
	MOLECULAR_MASS_COLUMN,
	MolecularMassResolver,
	withMolecularMassColumn,
} from './lib/molecular-mass'

type CardVariant = 'neighbor' | 'query'

type Neighbor = {
	queryId: string
	querySmiles: string
	compoundId: string
	compoundSmiles: string
	tanimoto: number | null
	props: Record<string, string>
	index: number
}

type ParsedInput = {
	rows: Neighbor[]
	displayColumns: string[]
	tanimotoColumn: string
}

type QueryGroup = {
	id: string
	smiles: string
	neighbors: Neighbor[]
}

const initializeNNViewer = () => {
	const queryCard = document.querySelector<HTMLUListElement>('#query-card')
	if (!queryCard) return

	const form = document.querySelector<HTMLFormElement>('#smiles-form')!
	const textarea = document.querySelector<HTMLTextAreaElement>('#smiles-text')!
	const fileInput = document.querySelector<HTMLInputElement>('#smiles-file')!
	const renderBtn = document.querySelector<HTMLButtonElement>('#render-btn')!
	const formError = document.querySelector<HTMLParagraphElement>('#form-error')!
	const formStatus = document.querySelector<HTMLParagraphElement>('#form-status')!
	const columns = document.querySelector<HTMLInputElement>('#columns')!
	const columnsValue = document.querySelector<HTMLSpanElement>('#columns-value')!
	const columnsPanel = document.querySelector<HTMLElement>('#columns-panel')!
	const displayPanel = document.querySelector<HTMLDivElement>('#display-panel')!
	const pillTemplate = document.querySelector<HTMLTemplateElement>('#pill-template')!
	const columnFiltersPanel = document.querySelector<HTMLDivElement>('#column-filters')!
	const gallerySection = document.querySelector<HTMLElement>('#gallery-section')!
	const gallery = document.querySelector<HTMLUListElement>('#gallery')!
	const renderSummary = document.querySelector<HTMLParagraphElement>('#render-summary')!
	const summaryRendered = renderSummary.querySelector<HTMLElement>('[data-rendered]')!
	const renderTotal = document.querySelector<HTMLParagraphElement>('#render-total')!
	const totalRendered = renderTotal.querySelector<HTMLElement>('[data-total-rendered]')!
	const querySlicer = document.querySelector<HTMLDivElement>('#query-slicer')!
	const queryRange = document.querySelector<HTMLInputElement>('#query-range')!
	const queryInput = document.querySelector<HTMLInputElement>('#query-input')!
	const queryTotal = document.querySelector<HTMLSpanElement>('#query-total')!
	const cardTemplate = document.querySelector<HTMLTemplateElement>('#card-template')!

	const ALLOWED_EXTENSIONS = ['.csv', '.tsv']
	const { show: showStatus, clear: clearStatus } = createStatusController(formStatus)
	const { show: showError, clear: clearError } = createMessageController(formError)

	let rdkitModule: RDKitModule | null = null
	let renderGeneration = 0
	let queryGroups: QueryGroup[] = []
	let currentQueryIndex = 0
	let currentQueryKey: string | null = null
	let activeNeighbors: Neighbor[] = []
	let activeRanks = new Map<Neighbor, number>()
	let svgRenderToken = 0
	const svgCache = new Map<string, string>()
	const molecularMass = new MolecularMassResolver()

	const applyColumns = () => {
		gallerySection.dataset.columns = columns.value
		columnsValue.textContent = columns.value
	}
	columns.addEventListener('input', applyColumns)
	applyColumns()

	const loadRDKit = createRDKitLoader({
		onStatus: showStatus,
		onReady: (module) => {
			rdkitModule = module
			renderBtn.disabled = false
			if (queryGroups.length > 0) renderCurrentQuery()
		},
	})

	requestIdle(() => {
		void loadRDKit().catch((error) => {
			renderBtn.disabled = false
			showError(error instanceof Error ? error.message : 'RDKit failed to load.')
			clearStatus()
		})
	})

	const normalizedColumn = (column: string) =>
		column.replace(/^\uFEFF/, '').trim().toLowerCase()

	const parseInput = (text: string): ParsedInput => {
		const lines = readRows(text)
		if (lines.length < 2) throw new Error('The CSV/TSV needs a header and at least one row.')

		const delimiter = lines[0].includes('\t') ? '\t' : ','
		const header = parseDelimitedLine(lines[0], delimiter)
		const lower = header.map(normalizedColumn)
		const requiredNames = [
			'query_id',
			'tanimoto',
			'query_smiles',
			'compound_smiles',
			'compound_id',
		]
		const indices = new Map(requiredNames.map((name) => [name, lower.indexOf(name)]))
		const missing = requiredNames.filter((name) => indices.get(name) === -1)
		if (missing.length > 0) throw new Error(`Missing columns: ${missing.join(', ')}`)

		const queryIdIdx = indices.get('query_id')!
		const tanimotoIdx = indices.get('tanimoto')!
		const querySmilesIdx = indices.get('query_smiles')!
		const compoundSmilesIdx = indices.get('compound_smiles')!
		const compoundIdIdx = indices.get('compound_id')!
		const excluded = new Set([queryIdIdx, querySmilesIdx, compoundSmilesIdx])
		const displayIndices = header.map((_, index) => index).filter((index) => !excluded.has(index))
		const displayColumns = displayIndices.map((index) => header[index])
		const rows: Neighbor[] = []

		for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
			const cells = parseDelimitedLine(lines[rowIndex], delimiter)
			const queryId = cells[queryIdIdx] ?? ''
			const querySmiles = cells[querySmilesIdx] ?? ''
			const compoundId = cells[compoundIdIdx] ?? ''
			const compoundSmiles = cells[compoundSmilesIdx] ?? ''
			if (!querySmiles || !compoundSmiles) continue

			const rawTanimoto = cells[tanimotoIdx] ?? ''
			const tanimoto = Number.parseFloat(rawTanimoto)
			const props: Record<string, string> = {}
			for (const index of displayIndices) props[header[index]] = cells[index] ?? ''
			rows.push({
				queryId,
				querySmiles,
				compoundId,
				compoundSmiles,
				tanimoto: Number.isFinite(tanimoto) ? tanimoto : null,
				props,
				index: rowIndex - 1,
			})
		}

		if (rows.length === 0) {
			throw new Error('No rows with query_SMILES and compound_SMILES were found.')
		}
		return { rows, displayColumns, tanimotoColumn: header[tanimotoIdx] }
	}

	const queryKey = (group: Pick<QueryGroup, 'id' | 'smiles'>) => `${group.id}\u0000${group.smiles}`

	const buildGroups = (rows: Neighbor[]): QueryGroup[] => {
		const grouped = new Map<string, QueryGroup>()
		for (const row of rows) {
			const key = queryKey({ id: row.queryId, smiles: row.querySmiles })
			if (!grouped.has(key)) {
				grouped.set(key, { id: row.queryId, smiles: row.querySmiles, neighbors: [] })
			}
			grouped.get(key)!.neighbors.push(row)
		}
		return [...grouped.values()]
	}

	const generateSvg = (smiles: string): string => {
		const cached = svgCache.get(smiles)
		if (cached !== undefined) {
			svgCache.delete(smiles)
			svgCache.set(smiles, cached)
			return cached
		}
		if (!rdkitModule) return ''

		let svg = ''
		const mol = rdkitModule.get_mol(smiles)
		try {
			if (mol?.is_valid()) {
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

		svgCache.set(smiles, svg)
		if (svgCache.size > 800) {
			const oldest = svgCache.keys().next().value
			if (oldest !== undefined) {
				svgCache.delete(oldest)
				molecularMass.delete(oldest)
			}
		}
		return svg
	}

	const buildCard = (
		smiles: string,
		id: string,
		values: string[],
		rank?: number | string,
		renderSvg = true,
		variant: CardVariant = 'query',
	) => {
		const card = cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement
		card.dataset.variant = variant
		const svgSlot = card.querySelector<HTMLElement>('[data-svg]')
		if (renderSvg) {
			const svg = generateSvg(smiles)
			if (svgSlot && svg) svgSlot.innerHTML = svg
		}
		setCardText(card, values, true)
		if (display.slots[2] !== null) card.dataset.displayRows = '2'
		if (rank !== undefined) {
			const rankElement = card.querySelector<HTMLElement>('[data-rank]')
			if (rankElement) {
				rankElement.hidden = false
				rankElement.textContent = typeof rank === 'number' ? `#${rank}` : rank
			}
		}
		setCopyButton(card, '[data-copy-id]', id, `Copy ID: ${id}`)
		setCopyButton(card, '[data-copy-smiles]', smiles, 'Copy SMILES')
		card.dataset.smiles = smiles
		return card
	}

	const paintCardSvg = (card: HTMLLIElement) => {
		const smiles = card.dataset.smiles
		const svgSlot = card.querySelector<HTMLElement>('[data-svg]')
		if (!smiles || !svgSlot || svgSlot.dataset.rendered === '1') return
		const svg = generateSvg(smiles)
		if (svg) svgSlot.innerHTML = svg
		svgSlot.dataset.rendered = '1'
	}

	const scheduleSvgRender = (cards: HTMLLIElement[]) => {
		const token = ++svgRenderToken
		if (!rdkitModule || cards.length === 0) return

		let index = 0
		const renderBatch = () => {
			if (token !== svgRenderToken) return
			const end = Math.min(cards.length, index + 8)
			for (; index < end; index++) paintCardSvg(cards[index])
			if (index < cards.length) requestAnimationFrame(renderBatch)
		}
		requestAnimationFrame(renderBatch)
	}

	const displayValue = (neighbor: Neighbor, column: string, resolveComputed = true) =>
		column === MOLECULAR_MASS_COLUMN
			? (resolveComputed ? molecularMass.get(neighbor.compoundSmiles, rdkitModule) : '')
			: (neighbor.props[column] ?? '')

	const formattedDisplayValue = (
		neighbor: Neighbor,
		column: string,
		resolveComputed = true,
	) => {
		const value = displayValue(neighbor, column, resolveComputed)
		return value && column === MOLECULAR_MASS_COLUMN ? `${value} Da` : value
	}
	const display = bindDisplayValues(displayPanel, pillTemplate, () => renderCurrentQuery())
	const columnFilters = bindColumnFilters(
		columnFiltersPanel,
		() => renderCurrentQuery(),
		displayValue,
	)

	const neighborCardValues = (neighbor: Neighbor, resolveComputed = true) => {
		const values = display.slots.map((column) =>
			column ? formattedDisplayValue(neighbor, column, resolveComputed) : '',
		)
		values[0] ||= neighbor.compoundSmiles
		return values
	}

	const queryCardValues = (group: QueryGroup) => {
		const values = display.slots.map((column) =>
			column === MOLECULAR_MASS_COLUMN ? molecularMass.format(group.smiles, rdkitModule) : '',
		)
		values[0] ||= group.id || group.smiles
		return values
	}

	const queryGroupsWithMatches = () =>
		queryGroups.filter((group) => group.neighbors.some(columnFilters.matches))

	const visibleNeighbors = (group: QueryGroup) => {
		const rows = group.neighbors.filter(columnFilters.matches)
		const column = display.sortedColumn
		if (!column) return rows
		const raw = (neighbor: Neighbor) => displayValue(neighbor, column).trim()
		const numeric = rows.every((neighbor) => raw(neighbor) === '' || Number.isFinite(Number(raw(neighbor))))
		const direction = display.sortDirection === 'desc' ? 1 : -1
		return [...rows].sort((a, b) => {
			const aValue = raw(a)
			const bValue = raw(b)
			if (aValue === '' || bValue === '') {
				return aValue === bValue ? a.index - b.index : aValue === '' ? 1 : -1
			}
			const comparison = numeric
				? Number(aValue) - Number(bValue)
				: aValue.localeCompare(bValue)
			return comparison === 0 ? a.index - b.index : -comparison * direction
		})
	}

	const rankNeighbors = (neighbors: Neighbor[]) => {
		const ranks = new Map<Neighbor, number>()
		const ranked = [...neighbors].sort((a, b) => {
			if (a.tanimoto === null || b.tanimoto === null) {
				return a.tanimoto === b.tanimoto ? a.index - b.index : a.tanimoto === null ? 1 : -1
			}
			const delta = b.tanimoto - a.tanimoto
			return delta === 0 ? a.index - b.index : delta
		})
		ranked.forEach((neighbor, index) => ranks.set(neighbor, index + 1))
		return ranks
	}

	const countUniqueCompounds = (neighbors: Neighbor[]) =>
		new Set(neighbors.map((neighbor) => neighbor.compoundSmiles)).size

	const updateSummary = () => {
		// Reserve the largest query's digit count, independently of the active query or filters.
		const maxNeighbors = queryGroups.reduce((max, group) => Math.max(max, group.neighbors.length), 0)
		summaryRendered.style.setProperty('--count-width', `${String(maxNeighbors).length}ch`)
		summaryRendered.textContent = String(activeNeighbors.length)
		renderSummary.hidden = queryGroups.length === 0
		const allNeighbors = queryGroups.flatMap((group) => group.neighbors)
		totalRendered.textContent = String(countUniqueCompounds(allNeighbors))
		renderTotal.hidden = queryGroups.length === 0
	}

	function renderCurrentQuery() {
		if (queryGroups.length === 0) {
			queryCard.replaceChildren()
			gallery.replaceChildren()
			activeNeighbors = []
			activeRanks = new Map()
			svgRenderToken++
			querySlicer.hidden = true
			currentQueryKey = null
			updateSummary()
			return
		}

		const matchingQueryGroups = queryGroupsWithMatches()
		if (matchingQueryGroups.length === 0) {
			queryCard.replaceChildren()
			gallery.replaceChildren()
			activeNeighbors = []
			activeRanks = new Map()
			svgRenderToken++
			querySlicer.hidden = true
			currentQueryIndex = 0
			updateSummary()
			return
		}

		const preservedIndex = currentQueryKey
			? matchingQueryGroups.findIndex((group) => queryKey(group) === currentQueryKey)
			: -1
		currentQueryIndex = preservedIndex >= 0
			? preservedIndex
			: Math.min(Math.max(0, currentQueryIndex), matchingQueryGroups.length - 1)
		const group = matchingQueryGroups[currentQueryIndex]
		currentQueryKey = queryKey(group)
		activeNeighbors = visibleNeighbors(group)
		activeRanks = rankNeighbors(group.neighbors)

		const query = buildCard(group.smiles, group.id, queryCardValues(group))
		queryCard.replaceChildren(query)
		const fragment = document.createDocumentFragment()
		const cards: HTMLLIElement[] = []
		for (const neighbor of activeNeighbors) {
			const card = buildCard(
				neighbor.compoundSmiles,
				neighbor.compoundId,
				neighborCardValues(neighbor),
				activeRanks.get(neighbor),
				false,
				'neighbor',
			)
			cards.push(card)
			fragment.append(card)
		}
		gallery.dataset.cardRows = display.slots[2] === null ? '1' : '2'
		gallery.scrollTop = 0
		gallery.replaceChildren(fragment)
		scheduleSvgRender(cards)
		querySlicer.hidden = false
		queryRange.max = String(matchingQueryGroups.length - 1)
		queryRange.value = String(currentQueryIndex)
		queryInput.value = String(currentQueryIndex + 1)
		queryTotal.textContent = String(matchingQueryGroups.length)
		updateSummary()
	}

	const navigateToMatchingQuery = (index: number) => {
		const matchingQueryGroups = queryGroupsWithMatches()
		if (matchingQueryGroups.length === 0) return
		currentQueryIndex = Math.min(Math.max(index, 0), matchingQueryGroups.length - 1)
		currentQueryKey = queryKey(matchingQueryGroups[currentQueryIndex])
		renderCurrentQuery()
	}

	const clearViewer = () => {
		queryGroups = []
		activeNeighbors = []
		currentQueryIndex = 0
		currentQueryKey = null
		queryCard.replaceChildren()
		gallery.replaceChildren()
		svgRenderToken++
		display.populate([])
		columnsPanel.hidden = true
		columnFilters.populate([])
		querySlicer.hidden = true
		updateSummary()
	}

	const renderInput = async () => {
		const generation = ++renderGeneration
		clearError()
		showStatus('Parsing input')
		const text = await readTextInput(textarea, fileInput, ALLOWED_EXTENSIONS)
		if (generation !== renderGeneration) return
		if (!text) throw new Error('Paste CSV/TSV text or upload a .csv/.tsv file.')

		const parsed = parseInput(text)
		queryGroups = buildGroups(parsed.rows)
		currentQueryIndex = 0
		currentQueryKey = null
		svgCache.clear()
		molecularMass.clear()
		const displayColumns = withMolecularMassColumn(parsed.displayColumns)
		display.populate(displayColumns, parsed.tanimotoColumn)
		columnFilters.populate(displayColumns)
		columnsPanel.hidden = false
		renderCurrentQuery()
		if (!rdkitModule) {
			showStatus('Loading RDKit')
			try {
				await loadRDKit()
			} catch (error) {
				if (generation !== renderGeneration) return
				throw error
			}
		}
		if (generation !== renderGeneration) return
		clearStatus()
	}

	const renderCsvUrlParam = async () => {
		const generation = renderGeneration
		const csvUrl = new URLSearchParams(window.location.search).get('csv')
		if (!csvUrl) return
		clearError()
		showStatus('Loading CSV/TSV')
		const response = await fetch(csvUrl)
		if (!response.ok) throw new Error(`Failed to fetch ${csvUrl}: ${response.status}`)
		if (generation !== renderGeneration) return
		textarea.value = await response.text()
		if (generation !== renderGeneration) return
		await renderInput()
	}

	form.addEventListener('submit', (event) => {
		event.preventDefault()
		renderBtn.disabled = true
		void renderInput()
			.catch((error) => {
				clearViewer()
				showError(error instanceof Error ? error.message : 'Could not render CSV/TSV.')
				clearStatus()
			})
			.finally(() => {
				renderBtn.disabled = false
			})
	})

	form.addEventListener('viewer:clean', () => {
		renderGeneration++
		svgCache.clear()
		molecularMass.clear()
		clearViewer()
		clearError()
		clearStatus()
		renderBtn.disabled = false
	})

	fileInput.addEventListener('change', () => {
		clearError()
		const file = fileInput.files?.[0]
		if (!file) return
		if (!isAllowedFile(file, ALLOWED_EXTENSIONS)) {
			showError('Upload a .csv or .tsv file.')
			return
		}
		if (file.size > MAX_FILE_SIZE) {
			showError(`File is too large (${formatMB(file.size)} MB). Max is ${formatMB(MAX_FILE_SIZE)} MB.`)
		}
	})

	const handleCopyClick = createCopyHandler()
	gallery.addEventListener('click', handleCopyClick)
	queryCard.addEventListener('click', handleCopyClick)

	queryRange.addEventListener('input', () => {
		navigateToMatchingQuery(Number(queryRange.value))
	})

	restrictToDigits(queryInput)
	queryInput.addEventListener('change', () => {
		const next = Number(queryInput.value)
		const matchingQueryGroups = queryGroupsWithMatches()
		if (!Number.isFinite(next) || matchingQueryGroups.length === 0) {
			queryInput.value = String(currentQueryIndex + 1)
			return
		}
		navigateToMatchingQuery(Math.min(Math.max(1, next), matchingQueryGroups.length) - 1)
	})

	bindHorizontalArrows((direction) => {
		const matchingQueryGroups = queryGroupsWithMatches()
		if (matchingQueryGroups.length === 0) return false
		const nextQueryIndex = Math.min(
			Math.max(currentQueryIndex + direction, 0),
			matchingQueryGroups.length - 1,
		)
		if (nextQueryIndex === currentQueryIndex) return false
		navigateToMatchingQuery(nextQueryIndex)
		return true
	})

	clearViewer()

	void renderCsvUrlParam().catch((error) => {
		clearViewer()
		showError(error instanceof Error ? error.message : 'Could not render CSV/TSV.')
		clearStatus()
	})
}

document.addEventListener('astro:page-load', initializeNNViewer)

export {}
