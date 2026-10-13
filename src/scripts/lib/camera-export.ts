export async function exportRows(gallery: HTMLElement, cards: HTMLElement[]) {
	if (!cards.length || !gallery.getClientRects().length) throw new Error('Render molecules in the viewer before exporting.')
	await document.fonts.ready
	const rowTops: number[] = []
	const selected: HTMLElement[] = []
	for (const card of cards) {
		if (!card.getClientRects().length) continue
		const top = Math.round(card.getBoundingClientRect().top)
		if (!rowTops.includes(top)) rowTops.push(top)
		if (rowTops.length > 3) break
		selected.push(card)
	}
	if (!selected.length) throw new Error('Show at least one molecule before exporting.')
	gallery.dispatchEvent(new CustomEvent('camera:hydrate', { detail: selected }))
	for (const card of selected) card.dataset.cameraExport = 'true'
	try {
		const bounds = selected.map((card) => card.getBoundingClientRect())
		const left = Math.min(...bounds.map((rect) => rect.left))
		const top = Math.min(...bounds.map((rect) => rect.top))
		const width = Math.max(...bounds.map((rect) => rect.right)) - left
		const height = Math.max(...bounds.map((rect) => rect.bottom)) - top
		const canvas = document.createElement('canvas')
		canvas.width = Math.ceil(width * 2)
		canvas.height = Math.ceil(height * 2)
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('Your browser does not support PNG export.')
		ctx.scale(2, 2)
		ctx.fillStyle = '#fff'
		ctx.fillRect(0, 0, width, height)
		ctx.translate(-left, -top)
		for (const card of selected) await drawCard(ctx, card)
		const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG export failed.')), 'image/png'))
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = 'molecules-camera-mode.png'
		link.click()
		window.setTimeout(() => URL.revokeObjectURL(url), 1000)
	} finally {
		for (const card of selected) delete card.dataset.cameraExport
	}
}

async function drawCard(ctx: CanvasRenderingContext2D, card: HTMLElement) {
	const rect = card.getBoundingClientRect()
	const style = getComputedStyle(card)
	ctx.strokeStyle = style.borderTopColor
	ctx.lineWidth = parseFloat(style.borderTopWidth)
	ctx.strokeRect(rect.left + 1, rect.top + 1, rect.width - 2, rect.height - 2)
	const svg = card.querySelector('[data-svg] svg')
	if (svg) {
		const svgRect = svg.getBoundingClientRect()
		const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }))
		try {
			const image = new Image()
			image.src = url
			await image.decode()
			ctx.drawImage(image, svgRect.left, svgRect.top, svgRect.width, svgRect.height)
		} finally {
			URL.revokeObjectURL(url)
		}
	} else {
		ctx.fillStyle = '#000'
		ctx.font = '24px sans-serif'
		ctx.fillText(';(', rect.left + rect.width / 2 - 8, rect.top + rect.width / 2)
	}
	const caption = card.querySelector('figcaption')!
	const captionRect = caption.getBoundingClientRect()
	ctx.beginPath()
	ctx.moveTo(captionRect.left, captionRect.top)
	ctx.lineTo(captionRect.right, captionRect.top)
	ctx.lineWidth = 1
	ctx.stroke()
	for (const span of caption.querySelectorAll('span')) {
		if (!span.getClientRects().length) continue
		const box = span.getBoundingClientRect()
		const textStyle = getComputedStyle(span)
		ctx.font = `${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`
		ctx.fillStyle = textStyle.color
		ctx.textBaseline = 'middle'
		let text = span.textContent ?? ''
		if (ctx.measureText(text).width > box.width) {
			while (text && ctx.measureText(`${text}…`).width > box.width) text = text.slice(0, -1)
			text += '…'
		}
		ctx.fillText(text, box.left, box.top + box.height / 2)
	}
}
