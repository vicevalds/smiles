import { exportRows } from './lib/camera-export'

export function initializeCameraMode(toggle: HTMLButtonElement) {
	const gallery = document.querySelector<HTMLElement>('#gallery')
	if (!gallery) throw new Error('Open a molecule viewer to use Camera Mode.')
	const controller = new AbortController()
	const { signal } = controller
	let active = false
	let concealed = false
	let dragging: HTMLElement | null = null
	let order: string[] = []
	const marked = new Set<string>()
	const cards = () => Array.from(gallery.children).filter((node): node is HTMLElement => node instanceof HTMLElement)
	const key = (card: HTMLElement) => card.dataset.itemIndex ?? ''
	const controls = document.querySelector<HTMLElement>('#camera-controls')!
	const status = document.querySelector<HTMLElement>('#camera-status')!
	const capture = document.querySelector<HTMLButtonElement>('#camera-export')!
	const visibility = document.querySelector<HTMLButtonElement>('#camera-visibility')!
	const setToggle = (button: HTMLButtonElement, pressed: boolean, label: string) => {
		button.setAttribute('aria-pressed', String(pressed))
		button.setAttribute('aria-label', label)
		button.title = label
	}

	const refresh = () => {
		controls.hidden = !active
		toggle.setAttribute('aria-pressed', String(active))
		setToggle(visibility, concealed, concealed ? 'Show marked cells' : 'Hide marked cells')
		for (const card of cards()) {
			const selected = marked.has(key(card))
			card.draggable = active
			card.hidden = active && concealed && selected
			card.dataset.cameraMarked = String(active && selected)
			const button = card.querySelector<HTMLButtonElement>('[data-camera-eye]')!
			button.hidden = !active
			setToggle(button, selected, selected ? 'Keep cell visible' : 'Mark cell to hide')
		}
	}
	const observer = new MutationObserver(() => {
		observer.disconnect()
		if (order.length) {
			const ranks = new Map(order.map((id, index) => [id, index]))
			const sorted = cards().sort((a, b) => (ranks.get(key(a)) ?? Infinity) - (ranks.get(key(b)) ?? Infinity))
			gallery.append(...sorted)
		}
		refresh()
		observer.observe(gallery, { childList: true })
	})
	observer.observe(gallery, { childList: true })
	visibility.addEventListener('click', () => {
		concealed = !concealed
		refresh()
	}, { signal })
	gallery.addEventListener('click', (event) => {
		const button = (event.target as Element).closest('[data-camera-eye]')
		if (!active || !button) return
		const card = button.closest('li')!
		const id = key(card)
		if (marked.has(id)) marked.delete(id)
		else marked.add(id)
		refresh()
	}, { signal })
	gallery.addEventListener('dragstart', (event) => {
		const target = event.target as Element
		if (!active || target.closest('button')) {
			event.preventDefault()
			return
		}
		dragging = target.closest('li')
		if (!dragging || !event.dataTransfer) return
		event.dataTransfer.effectAllowed = 'move'
		event.dataTransfer.setData('text/plain', key(dragging))
		dragging.dataset.dragging = 'true'
	}, { signal })
	gallery.addEventListener('dragover', (event) => {
		if (!dragging) return
		event.preventDefault()
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
		const bounds = gallery.getBoundingClientRect()
		if (event.clientY > bounds.bottom - 48) gallery.scrollTop += 16
		if (event.clientY < bounds.top + 48) gallery.scrollTop -= 16
	}, { signal })
	gallery.addEventListener('drop', (event) => {
		if (!dragging) return
		event.preventDefault()
		const target = (event.target as Element).closest('li')
		if (target && target !== dragging && target.parentElement === gallery) {
			const current = cards()
			const movingForward = current.indexOf(dragging) < current.indexOf(target)
			gallery.insertBefore(dragging, movingForward ? target.nextSibling : target)
			order = cards().map(key)
		}
	}, { signal })
	gallery.addEventListener('dragend', () => {
		if (dragging) delete dragging.dataset.dragging
		dragging = null
	}, { signal })
	gallery.addEventListener('camera:reset', () => {
		marked.clear()
		order = []
		concealed = false
		refresh()
	}, { signal })
	capture.addEventListener('click', async () => {
		capture.disabled = true
		try {
			await exportRows(gallery, cards())
			status.textContent = 'PNG exported.'
		} catch (error) {
			const message = error instanceof Error ? error.message : 'PNG export failed.'
			status.textContent = message
			window.alert(message)
		} finally {
			capture.disabled = false
		}
	}, { signal })
	document.addEventListener('astro:before-swap', () => {
		observer.disconnect()
		controller.abort()
	}, { once: true, signal })
	refresh()
	return {
		toggle() {
			active = !active
			refresh()
		},
	}
}

