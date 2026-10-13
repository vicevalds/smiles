import { renderLineChart, STAT_ORDER, STAT_LABELS, type StatMode, type ChartEntry } from './line-chart'
import { renderHistogram } from './histogram'
import { MOLECULAR_MASS_COLUMN, withMolecularMassColumn } from './molecular-mass'

type GraphOptions<T extends ChartEntry> = {
	reinventMode: boolean
	displayValue: (item: T, column: string) => string
	hasInvalidSmiles: (item: ChartEntry) => boolean
}

export const bindGraphs = <T extends ChartEntry>({ reinventMode, displayValue, hasInvalidSmiles }: GraphOptions<T>) => {
	const graphsList = document.querySelector<HTMLUListElement>('#graphs')!
	const chartTemplate = document.querySelector<HTMLTemplateElement>('#chart-template')!
	const creatorTemplate = document.querySelector<HTMLTemplateElement>('#creator-template')!
	const pillTemplate = document.querySelector<HTMLTemplateElement>('#pill-template')!
	let items: T[] = []
	let graphColumns: string[] = []
	let defaultX: string | null = null
	let defaultY: string | null = null

	const renderChart = (chart: HTMLLIElement) => renderLineChart(
		chart.querySelector<HTMLElement>('[data-plot]')!,
		chart.dataset.x!,
		chart.dataset.y!,
		chart.dataset.statMode as StatMode,
		items,
		hasInvalidSmiles,
		chart.dataset.omitAllZerosInMin === 'true',
	)

	const makeChart = (xCol: string, yCol: string, omitAllZerosInMin = false) => {
		const li = chartTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement
		li.dataset.x = xCol
		li.dataset.y = yCol
		li.dataset.statMode = 'mean'
		li.dataset.omitAllZerosInMin = String(omitAllZerosInMin)
		const title = reinventMode ? `${yCol} vs ${xCol}` : `Histogram of ${xCol}`
		const titleEl = li.querySelector<HTMLElement>('[data-title]')!
		titleEl.textContent = title
		titleEl.title = title
		if (!reinventMode) {
			li.querySelector('[data-stat]')?.remove()
			renderHistogram(li.querySelector<HTMLElement>('[data-plot]')!, xCol, items.map((item) => displayValue(item, xCol)))
			return li
		}
		renderChart(li)
		return li
	}

	const fillAxisPills = (group: HTMLElement, selected: string | null, columns = graphColumns) => {
		for (const c of columns) {
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
		const li = creatorTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement
		fillAxisPills(li.querySelector<HTMLElement>('[data-y-axis]')!, defaultY, reinventMode ? graphColumns : ['Histogram'])
		fillAxisPills(li.querySelector<HTMLElement>('[data-x-axis]')!, defaultX)
		refreshCreateBtn(li)
		return li
	}

	const buildGraphs = () => {
		graphsList.replaceChildren()
		if (graphColumns.length === 0) return
		if (reinventMode && defaultX && defaultY) {
			const isDefaultScoreStep =
				defaultX.replace(/^\uFEFF/, '').trim().toLowerCase() === 'step' &&
				defaultY.replace(/^\uFEFF/, '').trim().toLowerCase() === 'score'
			graphsList.append(makeChart(defaultX, defaultY, isDefaultScoreStep))
		}
		graphsList.append(makeCreator())
	}

	const findCol = (name: string) => graphColumns.find((c) => c.toLowerCase() === name) ?? null

	const populate = (entries: T[], stepColumn: string | null) => {
		items = entries
		const cols = items.length ? Object.keys(items[0].props) : []
		graphColumns = (items.length === 0 ? [] : reinventMode ? cols : withMolecularMassColumn(cols)).filter((col) => {
			if (!reinventMode && col === MOLECULAR_MASS_COLUMN) return true
			let any = false
			for (const item of items) {
				const v = (item.props[col] ?? '').trim()
				if (!v) continue
				if (!Number.isFinite(reinventMode ? parseFloat(v) : Number(v))) return false
				any = true
			}
			return any
		})
		defaultX =
			(stepColumn && graphColumns.includes(stepColumn) ? stepColumn : findCol('step')) ??
			graphColumns[0] ??
			null
		defaultY = reinventMode
			? findCol('score') ?? graphColumns.find((c) => c !== defaultX) ?? graphColumns[0] ?? null
			: 'Histogram'
		buildGraphs()
	}

	graphsList.addEventListener('click', (event) => {
		const target = event.target as HTMLElement
		if (target.closest('[data-remove]')) {
			target.closest('li')!.remove()
			return
		}

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
			graphsList.append(makeCreator())
			return
		}

		const statBtn = target.closest<HTMLButtonElement>('button[data-stat]')
		if (statBtn) {
			const li = statBtn.closest<HTMLLIElement>('li')!
			const cur = (li.dataset.statMode as StatMode) ?? 'mean'
			const next = STAT_ORDER[(STAT_ORDER.indexOf(cur) + 1) % STAT_ORDER.length]
			li.dataset.statMode = next
			statBtn.textContent = STAT_LABELS[next]
			renderChart(li)
		}
	})

	return { populate, clear: () => populate([], null) }
}
