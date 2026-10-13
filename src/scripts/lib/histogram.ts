import * as d3 from 'd3'
import { createChartTooltip } from './chart-tooltip'
import { showEmptyPlot } from './plot'

export const renderHistogram = (plot: HTMLElement, column: string, rawValues: string[]) => {
	const values = rawValues.filter((value) => value.trim() !== '').map(Number).filter(Number.isFinite)
	if (!values.length) {
		showEmptyPlot(plot)
		return
	}

	const width = 360
	const height = 280
	const margin = { top: 12, right: 18, bottom: 46, left: 58 }
	const innerWidth = width - margin.left - margin.right
	const innerHeight = height - margin.top - margin.bottom
	const [min, max] = d3.extent(values) as [number, number]
	const padding = min === max ? Math.max(Math.abs(min) * 0.05, 0.5) : 0
	const x = d3.scaleLinear().domain([min - padding, max + padding]).nice().range([0, innerWidth])
	const bins = d3.bin().domain(x.domain() as [number, number]).thresholds(20)(values)
	const y = d3.scaleLinear().domain([0, d3.max(bins, (bin) => bin.length)!]).nice().range([innerHeight, 0])
	const svg = d3.create('svg')
		.attr('viewBox', `0 0 ${width} ${height}`)
		.attr('class', 'chart-root')
		.attr('role', 'img')
		.attr('aria-label', `Histogram of ${column}, ${values.length} values`)
	const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
	g.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(6))
	g.append('g').call(d3.axisLeft(y).ticks(Math.min(6, y.domain()[1])).tickFormat(d3.format('d')))
	const bars = g.selectAll('rect').data(bins).join('rect')
		.attr('class', 'chart-bar')
		.attr('x', (bin) => x(bin.x0!) + 0.5)
		.attr('width', (bin) => Math.max(0, x(bin.x1!) - x(bin.x0!) - 1))
		.attr('y', (bin) => y(bin.length))
		.attr('height', (bin) => innerHeight - y(bin.length))
	svg.append('text').attr('x', margin.left + innerWidth / 2).attr('y', height - 8)
		.attr('text-anchor', 'middle').attr('data-axis-label', '').text(column)
	svg.append('text').attr('transform', 'rotate(-90)').attr('x', -(margin.top + innerHeight / 2))
		.attr('y', 15).attr('text-anchor', 'middle').attr('data-axis-label', '').text('Count')
	const tooltip = createChartTooltip(svg.node()!, width, height)
	const binIndex = d3.bisector((bin: d3.Bin<number, number>) => bin.x0!).right
	g.append('rect').attr('width', innerWidth).attr('height', innerHeight)
		.attr('data-chart-overlay', '')
		.on('mousemove', (event: MouseEvent) => {
			const [mx, my] = d3.pointer(event)
			const index = Math.max(0, Math.min(bins.length - 1, binIndex(bins, x.invert(mx)) - 1))
			const bin = bins[index]
			bars.attr('data-active', (_, barIndex) => String(barIndex === index))
			tooltip.show([
				`${column}: [${bin.x0}, ${bin.x1}${index === bins.length - 1 ? ']' : ')'}`,
				`Count: ${bin.length}`,
			], margin.left + mx, margin.top + my)
		})
		.on('mouseleave', () => {
			bars.attr('data-active', null)
			tooltip.hide()
		})
	plot.replaceChildren(svg.node()!)
}
