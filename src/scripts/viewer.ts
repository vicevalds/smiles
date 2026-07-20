import * as d3 from 'd3'
import { parseDelimitedLine, readRows } from './lib/csv'
import { isAllowedFile, MAX_FILE_SIZE } from './lib/files'
import { createRDKitLoader, requestIdle, type RDKitModule } from './lib/rdkit'
import { bindHorizontalArrows, createCopyHandler, createMessageController, restrictToDigits, setTitledText } from './lib/dom'
import { createStatusController } from './lib/status'
import {
	MOLECULAR_MASS_COLUMN,
	MolecularMassResolver,
	withMolecularMassColumn,
} from './lib/molecular-mass'

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
const columnOptions = document.querySelector<HTMLDivElement>('#column-options')!
const sortBtn = document.querySelector<HTMLButtonElement>('#sort-btn')!
const viewerRoot = document.querySelector<HTMLElement>('[data-viewer-mode]')!
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
	: ['.smi']

const applyColumns = () => {
	gallery.dataset.columns = columns.value
	columnsValue.textContent = columns.value
	renderGallery()
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

const parseInput = (text: string): Parsed => {
	const lines = readRows(text)
	if (lines.length === 0) return { entries: [], columns: [], stepColumn: null }
	if (!reinventMode) {
		const entries = lines.map((line) => {
			const [smiles, ...rest] = line.split(/\s+/)
			return { smiles, id: rest.join(' '), props: {} }
		})
		return { entries, columns: [], stepColumn: null }
	}

	const delimiter = lines[0].includes('\t') ? '\t' : ','
	const header = parseDelimitedLine(lines[0], delimiter)
	const lower = header.map((h) => h.toLowerCase())
	const isCsv = header.length > 1 && lower.includes('smiles')

	if (!isCsv) {
		const entries = lines.map((line) => {
			const [smiles, ...rest] = line.split(/\s+/)
			return { smiles, id: rest.join(' '), props: {} }
		})
		return { entries, columns: [], stepColumn: null }
	}

	const smilesIdx = lower.indexOf('smiles')
	const idIdx = lower.indexOf('id')

	const stepIdx = lower.indexOf('step')
	const stepColumn = stepIdx === -1 ? null : header[stepIdx]
	const propIdx = header.map((_, i) => i).filter((i) => i !== smilesIdx)
	const hiddenIdx = new Set([stepIdx])
	const columns = propIdx.filter((i) => !hiddenIdx.has(i)).map((i) => header[i])

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

let rdkitModule: RDKitModule | null = null
const svgCache = new Map<number, string>()
const molecularMass = new MolecularMassResolver()
const SVG_CACHE_CAP = 800
const generateSvg = (index: number): string => {
	const cached = svgCache.get(index)
	if (cached !== undefined) {
		svgCache.delete(index)
		svgCache.set(index, cached)
		return cached
	}
	let svg = ''
	if (rdkitModule) {
		const mol = rdkitModule.get_mol(items[index].smiles)
		try {
			if (mol?.is_valid()) {
				svg = mol.get_svg(300, 300)
				try {
					molecularMass.cacheDescriptors(items[index].smiles, mol.get_descriptors())
				} catch {
					molecularMass.cacheDescriptors(items[index].smiles, '')
				}
			}
		} finally {
			mol?.delete()
		}
	}
	svgCache.set(index, svg)
	if (svgCache.size > SVG_CACHE_CAP) {
		const oldest = svgCache.keys().next().value
		if (oldest !== undefined) svgCache.delete(oldest)
	}
	return svg
}
let slots: [string | null, string | null] = [null, null]
let sortSlot: 0 | 1 | null = null
let sortDir: 'desc' | 'asc' = 'desc'
let stepColumn: string | null = null
let smilesStateColumn: string | null = null
let steps: string[] = []
let currentStepIndex = 0

let view: 'viewer' | 'graphs' = 'viewer'
let hasDisplay = false
let graphColumns: string[] = []
let defaultX: string | null = null
let defaultY: string | null = null

const cardName = (item: Entry) =>
	(slots[0] && formattedDisplayValue(item, slots[0])) || (reinventMode ? '' : item.id) || item.smiles
const cardValue = (item: Entry) => (slots[1] ? formattedDisplayValue(item, slots[1]) : '')

const displayValue = (item: Entry, column: string) =>
	column === MOLECULAR_MASS_COLUMN
		? molecularMass.get(item.smiles, rdkitModule)
		: (item.props[column] ?? '')

const formattedDisplayValue = (item: Entry, column: string) => {
	const value = displayValue(item, column)
	return value && column === MOLECULAR_MASS_COLUMN ? `${value} Da` : value
}

const setCardValue = (card: HTMLLIElement, item: Entry) => setTitledText(card, '[data-value]', cardValue(item))
const setCardName = (card: HTMLLIElement, item: Entry) => setTitledText(card, '[data-name]', cardName(item))

const buildCard = (index: number) => {
	const item = items[index]
	const card = cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement
	const svg = generateSvg(index)
	const svgEl = card.querySelector<HTMLElement>('[data-svg]')
	if (svgEl && svg) svgEl.innerHTML = svg
	const copyButton = card.querySelector<HTMLButtonElement>('[data-copy-smiles]')
	if (copyButton) {
		copyButton.hidden = false
		copyButton.dataset.smiles = item.smiles
		copyButton.setAttribute('aria-label', 'Copy SMILES')
	}
	setCardName(card, item)
	setCardValue(card, item)
	return card
}

gallery.addEventListener('click', createCopyHandler())

const sortColumn = () => (sortSlot === null ? null : slots[sortSlot])

const computeOrder = (): number[] => {
	const base = items.map((_, i) => i)
	const col = sortColumn()
	if (!col) return base
	const raw = (i: number) => displayValue(items[i], col).trim()
	const numeric = base.every((i) => raw(i) === '' || Number.isFinite(parseFloat(raw(i))))
	const dir = sortDir === 'desc' ? 1 : -1
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
	const fragment = document.createDocumentFragment()
	for (const index of activeOrder) fragment.append(buildCard(index))
	gallery.replaceChildren(fragment)
}

const recompute = () => {
	activeOrder = computeOrder().filter(itemInStep)
	if (stepActive()) {
		stepInput.value = String(currentStepIndex + 1)
		setSummary(activeOrder.filter(hasValidSmilesState).length)
	} else if (reinventMode) {
		setSummary(activeOrder.filter(hasValidSmilesState).length)
	}
	if (reinventMode && items.length > 0) renderSummary.hidden = false
	renderGallery()
}

const updateSortLabel = () => {
	sortBtn.textContent = `Sort ${sortDir === 'desc' ? '↓' : '↑'}`
}

const updatePills = () => {
	columnOptions.querySelectorAll<HTMLButtonElement>('[data-column]').forEach((pill) => {
		const slot = slots[0] === pill.dataset.column ? 0 : slots[1] === pill.dataset.column ? 1 : null
		if (slot === null) delete pill.dataset.slot
		else pill.dataset.slot = String(slot)
		pill.setAttribute('aria-pressed', String(slot !== null))
	})
}

const populatePanel = (cols: string[], includeMolecularMass = false) => {
	const displayColumns = includeMolecularMass ? withMolecularMassColumn(cols) : cols
	slots = [null, null]
	sortSlot = null
	sortDir = 'desc'
	columnOptions.replaceChildren()
	updateSortLabel()
	sortBtn.disabled = true
	hasDisplay = displayColumns.length > 0
	if (!hasDisplay) {
		displayPanel.hidden = true
		return
	}
	displayPanel.hidden = view === 'graphs'
	for (const c of displayColumns) {
		const pill = pillTemplate.content.firstElementChild!.cloneNode(true) as HTMLButtonElement
		pill.dataset.column = c
		pill.textContent = c
		columnOptions.append(pill)
	}
}

columnOptions.addEventListener('click', (event) => {
	const pill = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-column]')
	if (!pill) return
	const col = pill.dataset.column!
	if (slots[0] === col) slots[0] = null
	else if (slots[1] === col) slots[1] = null
	else if (slots[0] === null) slots[0] = col
	else if (slots[1] === null) slots[1] = col
	else return

	if (sortSlot !== null && slots[sortSlot] === null) sortSlot = null
	if (sortSlot === null) {
		sortSlot = slots[0] !== null ? 0 : slots[1] !== null ? 1 : null
		sortDir = 'desc'
	}
	sortBtn.disabled = slots[0] === null && slots[1] === null
	updatePills()
	updateSortLabel()
	recompute()
})

sortBtn.addEventListener('click', () => {
	if (sortSlot === null) return
	sortDir = sortDir === 'desc' ? 'asc' : 'desc'
	updateSortLabel()
	recompute()
})

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

type StatMode = 'medoid' | 'mean' | 'max'
const STAT_ORDER: StatMode[] = ['mean', 'max', 'medoid']
const STAT_LABELS: Record<StatMode, string> = { medoid: 'Medoid', mean: 'Mean', max: 'Max' }

type StepStat = { x: number; mean: number; sd: number; max: number; medoid: number }

const renderChart = (plot: HTMLElement, xCol: string, yCol: string, stat: StatMode) => {
	const rows: { x: number; y: number }[] = []
	for (const item of items) {
		const x = parseFloat((item.props[xCol] ?? '').trim())
		const y = parseFloat((item.props[yCol] ?? '').trim())
		if (Number.isFinite(x) && Number.isFinite(y)) rows.push({ x, y })
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
			const sorted = [...ys].sort((a, b) => a - b)
			const mid = Math.floor(n / 2)
			const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
			const medoid = ys.reduce(
				(best, v) => (Math.abs(v - median) < Math.abs(best - median) ? v : best),
				ys[0],
			)
			return { x, mean, sd: Math.sqrt(Math.max(0, variance)), max, medoid }
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

const makeChart = (xCol: string, yCol: string) => {
	const li = chartTemplate!.content.firstElementChild!.cloneNode(true) as HTMLLIElement
	li.dataset.x = xCol
	li.dataset.y = yCol
	li.dataset.statMode = 'mean'
	const title = `${yCol} vs ${xCol}`
	const titleEl = li.querySelector<HTMLElement>('[data-title]')!
	titleEl.textContent = title
	titleEl.title = title
	li.querySelector<HTMLButtonElement>('[data-remove]')?.addEventListener('click', () => {
		li.remove()
	})
	renderChart(li.querySelector<HTMLElement>('[data-plot]')!, xCol, yCol, 'mean')
	return li
}

const fillAxisPills = (group: HTMLElement, selected: string | null) => {
	for (const c of graphColumns) {
		const pill = pillTemplate.content.firstElementChild!.cloneNode(true) as HTMLButtonElement
		pill.dataset.column = c
		pill.textContent = c
		if (c === selected) pill.dataset.slot = '0'
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
	if (defaultX && defaultY) graphsList.append(makeChart(defaultX, defaultY))
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
		group.querySelectorAll<HTMLElement>('[data-column]').forEach((p) => delete p.dataset.slot)
		if (!wasSelected) pill.dataset.slot = '0'
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
		renderChart(li.querySelector<HTMLElement>('[data-plot]')!, li.dataset.x!, li.dataset.y!, next)
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
	displayPanel.hidden = graphs || !hasDisplay
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
	applyView()
}

const hidePlaceholders = () => {
	renderSummary.hidden = true
	renderTotal.hidden = true
	stepSlicer.hidden = true
	populatePanel([])
	applyView()
}

const renderInput = async (text: string) => {
	renderBtn.disabled = true
	const parsed = parseInput(text)
	stepColumn = parsed.stepColumn
	gallery.replaceChildren()
	items = []
	activeOrder = []
	svgCache.clear()
	molecularMass.clear()
	smilesStateColumn = null
	steps = []
	currentStepIndex = 0
	stepSlicer.hidden = true
	setSummary(0)
	setTotals(0)
	populatePanel([])
	graphColumns = []
	buildGraphs()
	applyView()

	if (parsed.entries.length === 0) {
		renderBtn.disabled = false
		return
	}

	let rdkit: RDKitModule
	try {
		rdkit = await loadRDKit()
	} catch {
		showError('Failed to load the rendering engine. Check your connection and try again.')
		renderBtn.disabled = false
		return
	}

	rdkitModule = rdkit
	svgCache.clear()

	items = parsed.entries
	smilesStateColumn =
		Object.keys(items[0]?.props ?? {}).find(
			(column) => column.toLowerCase() === 'smiles_state',
		) ?? null
	setSummary(items.length)
	setTotals(items.length)
	renderSummary.hidden = !reinventMode

	populatePanel(parsed.columns, true)
	setupStepSlicer()
	setupGraphs()
	applyView()
	recompute()
	columnsPanel.hidden = false
	renderBtn.disabled = false
}

form.addEventListener('submit', async (event) => {
	event.preventDefault()
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

	await renderInput(text)
})

if (reinventMode) showPlaceholders()
else hidePlaceholders()

export {}
