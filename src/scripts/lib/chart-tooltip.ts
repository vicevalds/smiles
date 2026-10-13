import * as d3 from 'd3'

export const createChartTooltip = (svg: SVGSVGElement, width: number, height: number) => {
	const tip = d3.select(svg).append('g').attr('data-chart-tip-box', '').attr('data-visible', 'false')
	const background = tip.append('rect').attr('class', 'chart-tooltip-bg')
	const text = tip.append('text').attr('data-chart-tip', '')

	return {
		hide() {
			tip.attr('data-visible', 'false')
		},
		show(lines: string[], x: number, y: number) {
			text.selectAll('tspan').data(lines).join('tspan')
				.attr('x', 6).attr('y', (_, index) => 13 + index * 12).text((line) => line)
			tip.attr('data-visible', 'true')
			const bounds = text.node()!.getBBox()
			const boxWidth = bounds.width + 12
			const boxHeight = bounds.height + 10
			background.attr('width', boxWidth).attr('height', boxHeight)
			const left = x + boxWidth + 12 > width ? x - boxWidth - 12 : x + 12
			const top = y - boxHeight - 8 < 0 ? y + 12 : y - boxHeight - 8
			tip.attr('transform', `translate(${Math.max(0, Math.min(left, width - boxWidth))},${Math.max(0, Math.min(top, height - boxHeight))})`)
		},
	}
}
