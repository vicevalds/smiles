export const initializeFileDropZone = (zone: HTMLElement, input: HTMLInputElement) => {
	let dragDepth = 0

	const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files')
	const reset = () => {
		dragDepth = 0
		delete zone.dataset.dragging
	}

	zone.addEventListener('dragenter', (event) => {
		if (!hasFiles(event)) return
		event.preventDefault()
		dragDepth++
		zone.dataset.dragging = 'true'
	})

	zone.addEventListener('dragover', (event) => {
		if (!hasFiles(event)) return
		event.preventDefault()
		event.dataTransfer!.dropEffect = 'copy'
	})

	zone.addEventListener('dragleave', () => {
		dragDepth = Math.max(0, dragDepth - 1)
		if (dragDepth === 0) reset()
	})

	zone.addEventListener('drop', (event) => {
		reset()
		if (!hasFiles(event)) return
		event.preventDefault()
		const file = event.dataTransfer?.files[0]
		if (!file) return

		const transfer = new DataTransfer()
		transfer.items.add(file)
		input.files = transfer.files
		input.dispatchEvent(new Event('change', { bubbles: true }))
	})

	document.addEventListener('dragend', reset)
	document.addEventListener('drop', reset)
	document.addEventListener('astro:before-swap', () => {
		reset()
		document.removeEventListener('dragend', reset)
		document.removeEventListener('drop', reset)
	}, { once: true })
}
