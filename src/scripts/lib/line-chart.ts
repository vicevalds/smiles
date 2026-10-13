import * as d3 from 'd3'
import { createChartTooltip } from './chart-tooltip'
import { showEmptyPlot } from './plot'

export type ChartEntry = { smiles: string; props: Record<string, string> }

export type StatMode = 'medoid' | 'mean' | 'max' | 'min'
export const STAT_ORDER: StatMode[] = ['mean', 'max', 'min', 'medoid']
export const STAT_LABELS: Record<StatMode, string> = {
	medoid: 'Medoid',
	mean: 'Mean',
	max: 'Max',
	min: 'Min',
}

type StepStat = { x: number; mean: number; sd: number; max: number; min: number; medoid: number }

export const renderLineChart = (
	plot: HTMLElement,
	xCol: string,
	yCol: string,
	stat: StatMode,
	items: ChartEntry[],
	hasInvalidSmiles: (item: ChartEntry) => boolean,
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
		showEmptyPlot(plot)
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

	const tooltip = createChartTooltip(svg.node()!, W, H)

	const bisect = d3.bisector((d: StepStat) => d.x).center
	const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(3)))

	const overlay = g
		.append('rect')
		.attr('width', iw)
		.attr('height', ih)
		.attr('data-chart-overlay', '')

	const hideHover = () => {
		focus.attr('data-visible', 'false')
		tooltip.hide()
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

		tooltip.show([
			`${xCol}: ${fmt(d.x)}`,
			`${STAT_LABELS[stat]}: ${fmt(statValue(d))}`,
		], m.left + sx, m.top + sy)
	})

	plot.replaceChildren(svg.node())
}

