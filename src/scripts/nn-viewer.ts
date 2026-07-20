import { parseDelimitedLine, readRows } from './lib/csv'
import { formatMB, isAllowedFile, MAX_FILE_SIZE, readTextInput } from './lib/files'
import { createRDKitLoader, requestIdle, type RDKitModule } from './lib/rdkit'
import { bindHorizontalArrows, createCopyHandler, createMessageController, restrictToDigits, setText } from './lib/dom'
import { createStatusController } from './lib/status'

type SortMode = 'desc' | 'asc'
type ActiveSort = 'similarity' | 'value'
type CardVariant = 'neighbor' | 'query' | 'cutoff'
type NumericFilterOperator = '>' | '<' | '='

type NumericFilterControl = {
	element: HTMLElement
	readonly enabled: boolean
	matches: (candidate: number) => boolean
	disable: () => void
	reset: (value?: number | null) => void
}

type Neighbor = {
	queryName: string
	querySmiles: string
	compoundSmiles: string
	tanimoto: number | null
	props: Record<string, string>
	index: number
}

type ParsedInput = {
	rows: Neighbor[]
	displayColumns: string[]
}

type QueryGroup = {
	name: string
	smiles: string
	neighbors: Neighbor[]
}

const form = document.querySelector<HTMLFormElement>('#smiles-form')!
const textarea = document.querySelector<HTMLTextAreaElement>('#smiles-text')!
const fileInput = document.querySelector<HTMLInputElement>('#smiles-file')!
const renderBtn = document.querySelector<HTMLButtonElement>('#render-btn')!
const formError = document.querySelector<HTMLParagraphElement>('#form-error')!
const formStatus = document.querySelector<HTMLParagraphElement>('#form-status')!
const displayPanel = document.querySelector<HTMLDivElement>('#display-panel')!
const columnOptions = document.querySelector<HTMLDivElement>('#column-options')!
const pillTemplate = document.querySelector<HTMLTemplateElement>('#pill-template')!
const sortPanel = document.querySelector<HTMLElement>('#nn-sort')!
const sortBtn = document.querySelector<HTMLButtonElement>('#tanimoto-sort')!
const valueSortBtn = document.querySelector<HTMLButtonElement>('#value-sort')!
const gallery = document.querySelector<HTMLUListElement>('#gallery')!
const queryCard = document.querySelector<HTMLUListElement>('#query-card')!
const renderSummary = document.querySelector<HTMLParagraphElement>('#render-summary')!
const summaryRendered = renderSummary.querySelector<HTMLElement>('[data-rendered]')!
const renderTotal = document.querySelector<HTMLParagraphElement>('#render-total')!
const totalRendered = renderTotal.querySelector<HTMLElement>('[data-total-rendered]')!
const filteredTotalRendered = renderTotal.querySelector<HTMLElement>('[data-filtered-total-rendered]')!
const querySlicer = document.querySelector<HTMLDivElement>('#query-slicer')!
const queryRange = document.querySelector<HTMLInputElement>('#query-range')!
const queryInput = document.querySelector<HTMLInputElement>('#query-input')!
const queryTotal = document.querySelector<HTMLSpanElement>('#query-total')!
const cardTemplate = document.querySelector<HTMLTemplateElement>('#card-template')!

const ALLOWED_EXTENSIONS = ['.csv', '.tsv']
const ATOMIC_MASS_COLUMN = 'Atomic Mass'
const numericFilterOperatorCycle: NumericFilterOperator[] = ['>', '<', '=']

const createNumericFilterControl = (
	id: string,
	onChange: () => void,
): NumericFilterControl => {
	const element = document.querySelector<HTMLElement>(`#${id}`)!
	const operatorButton = document.querySelector<HTMLButtonElement>(`#${id}-operator`)!
	const input = document.querySelector<HTMLInputElement>(`#${id}-input`)!
	const toggleButton = document.querySelector<HTMLButtonElement>(`#${id}-toggle`)!
	const ariaLabel = operatorButton.getAttribute('aria-label')?.split(' comparison:')[0] ?? id
	let operator: NumericFilterOperator = '>'
	let enabled = false
	const initialValue = input.value.trim() ? Number(input.value) : Number.NaN
	let value: number | null = Number.isFinite(initialValue) ? initialValue : null

	const updateControls = () => {
		operatorButton.textContent = operator
		operatorButton.setAttribute(
			'aria-label',
			`${ariaLabel} comparison: ${operator === '>' ? 'greater than' : operator === '<' ? 'less than' : 'equal to'}`,
		)
		toggleButton.textContent = enabled ? 'On' : 'Off'
		toggleButton.setAttribute('aria-pressed', String(enabled))
	}

	const parseInput = () => {
		const rawValue = input.value.trim()
		if (!rawValue) return null
		const parsed = Number(rawValue)
		const min = input.min === '' ? null : Number(input.min)
		return Number.isFinite(parsed) && (min === null || parsed >= min) ? parsed : null
	}

	const commitInput = () => {
		const parsed = parseInput()
		if (parsed === null) {
			input.value = value === null ? '' : String(value)
			return false
		}
		value = parsed
		input.value = String(parsed)
		return true
	}

	const setEnabled = (nextEnabled: boolean) => {
		enabled = nextEnabled && value !== null
		updateControls()
	}

	const commitAndApply = (enableAfterCommit = false) => {
		const wasEnabled = enabled
		const committed = commitInput()
		if (!committed && enabled) setEnabled(false)
		if (committed && enableAfterCommit) {
			setEnabled(true)
			toggleButton.focus()
		}
		if (committed || wasEnabled) onChange()
	}

	operatorButton.addEventListener('click', () => {
		const index = numericFilterOperatorCycle.indexOf(operator)
		operator = numericFilterOperatorCycle[(index + 1) % numericFilterOperatorCycle.length]
		updateControls()
		onChange()
	})

	input.addEventListener('keydown', (event) => {
		if (event.key === '-' && input.min !== '' && Number(input.min) >= 0) {
			event.preventDefault()
			return
		}
		if (event.key !== 'Enter') return
		event.preventDefault()
		commitAndApply(true)
	})
	input.addEventListener('input', () => {
		const min = input.min === '' ? null : Number(input.min)
		const parsed = Number(input.value)
		if (input.value && min !== null && Number.isFinite(parsed) && parsed < min) {
			input.value = String(min)
		}
	})
	input.addEventListener('change', () => commitAndApply())

	toggleButton.addEventListener('click', () => {
		const nextEnabled = !enabled
		if (nextEnabled && !commitInput()) {
			input.focus()
			return
		}
		setEnabled(nextEnabled)
		onChange()
	})

	updateControls()
	return {
		element,
		get enabled() {
			return enabled
		},
		matches(candidate) {
			if (value === null || !Number.isFinite(candidate)) return false
			if (operator === '>') return candidate > value
			if (operator === '<') return candidate < value
			return candidate === value
		},
		disable() {
			setEnabled(false)
		},
		reset(nextValue = null) {
			operator = '>'
			value = nextValue
			input.value = nextValue === null ? '' : String(nextValue)
			setEnabled(false)
		},
	}
}

const similarityFilterControl = createNumericFilterControl(
	'similarity-cutoff',
	() => renderCurrentQuery(),
)
const valueFilterControl = createNumericFilterControl('value-filter', () => renderCurrentQuery())

let rdkitModule: RDKitModule | null = null
let queryGroups: QueryGroup[] = []
let currentQueryIndex = 0
let currentQuerySmiles: string | null = null
let sortMode: SortMode = 'desc'
let valueSortMode: SortMode = 'desc'
let activeSort: ActiveSort = 'similarity'
const svgCache = new Map<string, string>()
const molecularMassCache = new Map<string, string>()
let activeNeighbors: Neighbor[] = []
let activeRanks = new Map<Neighbor, number>()
let svgRenderToken = 0
let displayColumns: string[] = []
let selectedDisplayColumn: string | null = null
const { show: showStatus, clear: clearStatus } = createStatusController(formStatus)
const { show: showError, clear: clearError } = createMessageController(formError)

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

const CORE_CSV_COLUMNS = new Set([
	'group',
	'query',
	'tanimoto',
	'query_smiles',
	'query smiles',
	'compound_smiles',
	'compound smiles',
	'smiles',
])

const parseSmi = (text: string): ParsedInput => {
	const lines = readRows(text)
	if (lines.length === 0) throw new Error('Paste SMILES text or upload a .smi/.csv file.')

	const firstSmiles = lines[0].split(/\s+/)[0]
	const rows: Neighbor[] = []
	let hasId = false
	for (let rowIndex = 0; rowIndex < lines.length; rowIndex++) {
		const [smiles, ...rest] = lines[rowIndex].split(/\s+/)
		if (!smiles) continue
		const id = rest.join(' ')
		if (id) hasId = true
		rows.push({
			queryName: 'SMI',
			querySmiles: firstSmiles,
			compoundSmiles: smiles,
			tanimoto: null,
			props: id ? { id } : {},
			index: rowIndex,
		})
	}
	if (rows.length === 0) throw new Error('No SMILES rows were found.')
	return { rows, displayColumns: hasId ? ['id'] : [] }
}

const parseTabular = (text: string, delimiter: ',' | '\t'): ParsedInput => {
	const lines = readRows(text)
	if (lines.length < 2) throw new Error('The CSV/TSV needs a header and at least one row.')

	const header = parseDelimitedLine(lines[0], delimiter)
	const lower = header.map((name) => name.toLowerCase())
	const indexOf = (...names: string[]) => {
		for (const name of names) {
			const index = lower.indexOf(name)
			if (index !== -1) return index
		}
		return -1
	}

	const queryIdx = indexOf('query')
	const tanimotoIdx = indexOf('tanimoto')
	const querySmilesIdx = indexOf('query_smiles', 'query smiles')
	const compoundSmilesIdx = indexOf('compound_smiles', 'compound smiles', 'smiles')
	const required: Array<[string, number]> = [
		['tanimoto', tanimotoIdx],
		['query_SMILES', querySmilesIdx],
		['compound_SMILES', compoundSmilesIdx],
	].filter(([, index]) => index === -1)

	if (required.length > 0) {
		throw new Error(`Missing columns: ${required.map(([name]) => name).join(', ')}`)
	}

	const displayColumns = header.filter((name) => !CORE_CSV_COLUMNS.has(name.toLowerCase()))
	const rows: Neighbor[] = []
	for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
		const cells = parseDelimitedLine(lines[rowIndex], delimiter)
		const querySmiles = cells[querySmilesIdx] ?? ''
		const compoundSmiles = cells[compoundSmilesIdx] ?? ''
		if (!querySmiles || !compoundSmiles) continue

		const tanimoto = Number.parseFloat(cells[tanimotoIdx] ?? '')
		const props: Record<string, string> = {}
		for (const column of displayColumns) {
			const index = header.indexOf(column)
			props[column] = cells[index] ?? ''
		}
		rows.push({
			queryName: queryIdx === -1 ? '' : (cells[queryIdx] ?? ''),
			querySmiles,
			compoundSmiles,
			tanimoto: Number.isFinite(tanimoto) ? tanimoto : null,
			props,
			index: rowIndex - 1,
		})
	}

	if (rows.length === 0) throw new Error('No rows with query_SMILES and compound_SMILES were found.')
	return { rows, displayColumns }
}

const parseInput = (text: string): ParsedInput => {
	const firstLine = readRows(text)[0]
	if (!firstLine) throw new Error('Paste SMILES text or upload a .csv/.tsv file.')
	const delimiter = firstLine.includes('\t') ? '\t' : ','
	const lowerHeader = parseDelimitedLine(firstLine, delimiter).map((name) => name.toLowerCase())
	const looksTabular = delimiter === '\t' || lowerHeader.some((name) => CORE_CSV_COLUMNS.has(name))
	return looksTabular
		? parseTabular(text, delimiter)
		: parseSmi(text)
}

const buildGroups = (rows: Neighbor[]): QueryGroup[] => {
	const grouped = new Map<string, QueryGroup>()
	for (const row of rows) {
		const key = row.querySmiles
		if (!grouped.has(key)) {
			grouped.set(key, { name: row.queryName, smiles: row.querySmiles, neighbors: [] })
		}
		grouped.get(key)!.neighbors.push(row)
	}
	return [...grouped.values()]
}

const formatTanimoto = (value: number | null) => (value === null ? 'n/a' : value.toFixed(3))

const cacheMolecularMass = (smiles: string, descriptorsJson: string) => {
	try {
		const descriptors = JSON.parse(descriptorsJson) as { amw?: unknown }
		const mass = Number(descriptors.amw)
		molecularMassCache.set(smiles, Number.isFinite(mass) ? mass.toFixed(1) : '')
	} catch {
		molecularMassCache.set(smiles, '')
	}
}

const getMolecularMass = (smiles: string) => {
	const cached = molecularMassCache.get(smiles)
	if (cached !== undefined) return cached
	if (!rdkitModule) return ''

	const mol = rdkitModule.get_mol(smiles)
	try {
		if (!mol?.is_valid()) {
			molecularMassCache.set(smiles, '')
			return ''
		}
		cacheMolecularMass(smiles, mol.get_descriptors())
		return molecularMassCache.get(smiles) ?? ''
	} catch {
		molecularMassCache.set(smiles, '')
		return ''
	} finally {
		mol?.delete()
	}
}

const generateSvg = (smiles: string): string => {
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
			if (mol?.is_valid()) {
				svg = mol.get_svg(300, 300)
				try {
					cacheMolecularMass(smiles, mol.get_descriptors())
				} catch {
					molecularMassCache.set(smiles, '')
				}
			} else molecularMassCache.set(smiles, '')
		} finally {
			mol?.delete()
		}
	} else {
		return ''
	}
	svgCache.set(smiles, svg)
	if (svgCache.size > 800) {
		const oldest = svgCache.keys().next().value
		if (oldest !== undefined) {
			svgCache.delete(oldest)
			molecularMassCache.delete(oldest)
		}
	}
	return svg
}

const setCardVariant = (card: HTMLElement, variant: CardVariant) => {
	card.dataset.variant = variant
}

const revealCardControl = (card: HTMLElement, selector: string, text: string) => {
	const el = card.querySelector<HTMLElement>(selector)
	if (!el) return
	el.hidden = false
	el.textContent = text
}

const buildCard = (
	smiles: string,
	name: string,
	value: string,
	rank?: number | string,
	renderSvg = true,
	variant: CardVariant = 'query',
) => {
	const card = cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement
	setCardVariant(card, variant)
	const svgSlot = card.querySelector<HTMLElement>('[data-svg]')
	if (renderSvg) {
		const svg = generateSvg(smiles)
		if (svgSlot && svg) svgSlot.innerHTML = svg
	}
	setText(card, '[data-name]', name)
	setText(card, '[data-value]', value)
	if (rank !== undefined) revealCardControl(card, '[data-rank]', `#${rank}`)
	const copyButton = card.querySelector<HTMLButtonElement>('[data-copy-smiles]')
	if (copyButton) {
		copyButton.hidden = false
		copyButton.dataset.smiles = smiles
		copyButton.setAttribute('aria-label', 'Copy SMILES')
	}
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

const selectedDisplayValue = (neighbor: Neighbor) => {
	if (selectedDisplayColumn === ATOMIC_MASS_COLUMN) {
		return getMolecularMass(neighbor.compoundSmiles)
	}
	return selectedDisplayColumn ? (neighbor.props[selectedDisplayColumn] ?? '') : ''
}

const formatSelectedDisplayValue = (neighbor: Neighbor) => {
	const value = selectedDisplayValue(neighbor)
	return value && selectedDisplayColumn === ATOMIC_MASS_COLUMN ? `${value} Da` : value
}

const selectedQueryDisplayValue = (group: QueryGroup) => {
	if (selectedDisplayColumn !== ATOMIC_MASS_COLUMN) return group.name
	const mass = getMolecularMass(group.smiles)
	return mass ? `${mass} Da` : ''
}

const matchesSimilarityFilter = (neighbor: Neighbor) =>
	!similarityFilterControl.enabled ||
	(neighbor.tanimoto !== null && similarityFilterControl.matches(neighbor.tanimoto))

const matchesValueFilter = (neighbor: Neighbor) => {
	if (!valueFilterControl.enabled) return true
	const value = Number.parseFloat(selectedDisplayValue(neighbor).trim())
	return valueFilterControl.matches(value)
}

const matchesActiveFilters = (neighbor: Neighbor) =>
	matchesSimilarityFilter(neighbor) && matchesValueFilter(neighbor)

const queryGroupsWithMatches = () =>
	queryGroups.filter((group) => group.neighbors.some(matchesActiveFilters))

const visibleNeighbors = (group: QueryGroup) => {
	let rows = group.neighbors.filter(matchesActiveFilters)
	if (activeSort === 'value' && selectedDisplayColumn) {
		const dir = valueSortMode === 'desc' ? -1 : 1
		rows = [...rows].sort((a, b) => {
			const av = Number.parseFloat(selectedDisplayValue(a))
			const bv = Number.parseFloat(selectedDisplayValue(b))
			const aOk = Number.isFinite(av)
			const bOk = Number.isFinite(bv)
			if (!aOk || !bOk) return aOk === bOk ? a.index - b.index : aOk ? -1 : 1
			const delta = av - bv
			return delta === 0 ? a.index - b.index : delta * dir
		})
	} else {
		const dir = sortMode === 'desc' ? -1 : 1
		rows = [...rows].sort((a, b) => {
			if (a.tanimoto === null || b.tanimoto === null) {
				return a.tanimoto === b.tanimoto ? a.index - b.index : a.tanimoto === null ? 1 : -1
			}
			const delta = a.tanimoto - b.tanimoto
			return delta === 0 ? a.index - b.index : delta * dir
		})
	}
	return rows
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

const cardVariant = (neighbor: Neighbor): CardVariant =>
	neighbor.tanimoto !== null && similarityFilterControl.matches(neighbor.tanimoto)
		? 'cutoff'
		: 'neighbor'

const updateSortLabel = () => {
	sortBtn.textContent = `Similarity ${sortMode === 'desc' ? '↓' : '↑'}`
	valueSortBtn.textContent = `Value ${selectedDisplayColumn === null ? '-' : valueSortMode === 'desc' ? '↓' : '↑'}`
	sortBtn.setAttribute('aria-pressed', String(activeSort === 'similarity'))
	valueSortBtn.setAttribute('aria-pressed', String(activeSort === 'value'))
}

const updateDisplayPills = () => {
	columnOptions.querySelectorAll<HTMLButtonElement>('[data-column]').forEach((pill) => {
		const isActive = pill.dataset.column === selectedDisplayColumn
		if (isActive) pill.dataset.slot = '0'
		else delete pill.dataset.slot
		pill.setAttribute('aria-pressed', String(isActive))
	})
}

const populateDisplayPanel = (columns: string[]) => {
	displayColumns = [ATOMIC_MASS_COLUMN, ...columns.filter((column) => column !== ATOMIC_MASS_COLUMN)]
	selectedDisplayColumn = displayColumns.includes(selectedDisplayColumn ?? '')
		? selectedDisplayColumn
		: ATOMIC_MASS_COLUMN
	columnOptions.replaceChildren()
	displayPanel.hidden = false
	for (const column of displayColumns) {
		const pill = pillTemplate.content.firstElementChild!.cloneNode(true) as HTMLButtonElement
		pill.dataset.column = column
		pill.textContent = column
		columnOptions.append(pill)
	}
	updateDisplayPills()
}

const countUniqueCompounds = (neighbors: Neighbor[]) =>
	new Set(neighbors.map((neighbor) => neighbor.compoundSmiles)).size

const updateSummary = () => {
	const filteredNeighbors = queryGroups.flatMap((group) => group.neighbors.filter(matchesActiveFilters))
	summaryRendered.textContent = String(activeNeighbors.length)
	renderSummary.hidden = queryGroups.length === 0
	const allNeighbors = queryGroups.flatMap((group) => group.neighbors)
	const total = countUniqueCompounds(allNeighbors)
	totalRendered.textContent = String(total)
	filteredTotalRendered.textContent = String(countUniqueCompounds(filteredNeighbors))
	renderTotal.hidden = queryGroups.length === 0
}

const renderCurrentQuery = () => {
	if (queryGroups.length === 0) {
		queryCard.replaceChildren()
		gallery.replaceChildren()
		activeNeighbors = []
		activeRanks = new Map()
		svgRenderToken++
		sortPanel.hidden = true
		displayPanel.hidden = true
		similarityFilterControl.element.hidden = true
		valueFilterControl.element.hidden = true
		querySlicer.hidden = true
		currentQuerySmiles = null
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
		sortPanel.hidden = false
		similarityFilterControl.element.hidden = false
		valueFilterControl.element.hidden = false
		querySlicer.hidden = true
		currentQueryIndex = 0
		updateSummary()
		return
	}

	const preservedIndex = currentQuerySmiles
		? matchingQueryGroups.findIndex((group) => group.smiles === currentQuerySmiles)
		: -1
	currentQueryIndex = preservedIndex >= 0
		? preservedIndex
		: Math.min(Math.max(0, currentQueryIndex), matchingQueryGroups.length - 1)
	const group = matchingQueryGroups[currentQueryIndex]
	currentQuerySmiles = group.smiles
	activeNeighbors = visibleNeighbors(group)
	activeRanks = rankNeighbors(group.neighbors)
	const query = buildCard(group.smiles, selectedQueryDisplayValue(group), '')
	revealCardControl(query, '[data-rank]', 'Query')
	queryCard.replaceChildren(query)
	const fragment = document.createDocumentFragment()
	const cards: HTMLLIElement[] = []
	for (const neighbor of activeNeighbors) {
		const card = buildCard(
			neighbor.compoundSmiles,
			formatSelectedDisplayValue(neighbor),
			formatTanimoto(neighbor.tanimoto),
			activeRanks.get(neighbor),
			false,
			cardVariant(neighbor),
		)
		cards.push(card)
		fragment.append(card)
	}
	gallery.scrollTop = 0
	gallery.replaceChildren(fragment)
	scheduleSvgRender(cards)
	sortPanel.hidden = false
	similarityFilterControl.element.hidden = false
	valueFilterControl.element.hidden = false
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
	currentQuerySmiles = matchingQueryGroups[currentQueryIndex].smiles
	renderCurrentQuery()
}

const renderInput = async () => {
	clearError()
	showStatus('Parsing input')
	const text = await readTextInput(textarea, fileInput, ALLOWED_EXTENSIONS)
	if (!text) throw new Error('Paste CSV/TSV text or upload a .csv/.tsv file.')

	const { rows, displayColumns } = parseInput(text)
	queryGroups = buildGroups(rows)
	currentQueryIndex = 0
	currentQuerySmiles = null
	sortMode = 'desc'
	valueSortMode = 'desc'
	activeSort = 'similarity'
	selectedDisplayColumn = ATOMIC_MASS_COLUMN
	valueFilterControl.reset()
	populateDisplayPanel(displayColumns)
	updateSortLabel()
	renderCurrentQuery()
	if (!rdkitModule) {
		showStatus('Loading RDKit')
		await loadRDKit()
	}
	clearStatus()
}

const renderCsvUrlParam = async () => {
	const csvUrl = new URLSearchParams(window.location.search).get('csv')
	if (!csvUrl) return
	clearError()
	showStatus('Loading CSV/TSV')
	const response = await fetch(csvUrl)
	if (!response.ok) throw new Error(`Failed to fetch ${csvUrl}: ${response.status}`)
	textarea.value = await response.text()
	await renderInput()
}

form.addEventListener('submit', (event) => {
	event.preventDefault()
	renderBtn.disabled = true
	void renderInput()
		.catch((error) => {
			queryGroups = []
			renderCurrentQuery()
			showError(error instanceof Error ? error.message : 'Could not render CSV/TSV.')
			clearStatus()
		})
		.finally(() => {
			renderBtn.disabled = false
		})
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

columnOptions.addEventListener('click', (event) => {
	const pill = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-column]')
	if (!pill?.dataset.column) return
	const nextColumn = pill.dataset.column === selectedDisplayColumn ? null : pill.dataset.column
	valueFilterControl.disable()
	selectedDisplayColumn = nextColumn
	valueSortMode = 'desc'
	activeSort = nextColumn === null ? 'similarity' : 'value'
	updateDisplayPills()
	updateSortLabel()
	renderCurrentQuery()
})

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

sortBtn.addEventListener('click', () => {
	sortMode = sortMode === 'desc' ? 'asc' : 'desc'
	activeSort = 'similarity'
	updateSortLabel()
	renderCurrentQuery()
})

valueSortBtn.addEventListener('click', () => {
	if (!selectedDisplayColumn) return
	valueSortMode = valueSortMode === 'desc' ? 'asc' : 'desc'
	activeSort = 'value'
	updateSortLabel()
	renderCurrentQuery()
})

updateSortLabel()

void renderCsvUrlParam().catch((error) => {
	queryGroups = []
	renderCurrentQuery()
	showError(error instanceof Error ? error.message : 'Could not render CSV/TSV.')
	clearStatus()
})
