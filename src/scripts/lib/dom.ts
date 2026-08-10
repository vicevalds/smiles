export const setText = (root: ParentNode, selector: string, text: string) => {
	const element = root.querySelector<HTMLElement>(selector)
	if (!element) return
	element.textContent = text
}

export const setTitledText = (root: ParentNode, selector: string, text: string) => {
	const element = root.querySelector<HTMLElement>(selector)
	if (!element) return
	element.textContent = text
	element.title = text
}

const CARD_TEXT_SELECTORS = ['[data-name]', '[data-value]', '[data-extra-name]', '[data-extra-value]']

export const setCardText = (root: ParentNode, values: string[], titled = false) => {
	const setter = titled ? setTitledText : setText
	CARD_TEXT_SELECTORS.forEach((selector, index) => setter(root, selector, values[index] ?? ''))
}

export const createMessageController = (element: HTMLElement) => ({
	show(message: string) {
		element.textContent = message
		element.hidden = false
	},
	clear() {
		element.textContent = ''
		element.hidden = true
	},
})

export const copyText = async (text: string) => {
	try {
		await navigator.clipboard.writeText(text)
		return
	} catch {
		const textarea =
			document.querySelector<HTMLTextAreaElement>('#clipboard-fallback') ??
			document.createElement('textarea')
		const removeAfterCopy = !textarea.isConnected
		textarea.value = text
		if (removeAfterCopy) document.body.append(textarea)
		textarea.select()
		document.execCommand('copy')
		textarea.value = ''
		if (removeAfterCopy) textarea.remove()
	}
}

export const createCopyHandler = () => (event: MouseEvent) => {
	const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-button]')
	const value = button?.dataset.copyValue
	if (!button || value === undefined) return
	void copyText(value).then(() => {
		button.textContent = button.dataset.copySuccessText ?? 'Copied'
		window.setTimeout(() => {
			button.textContent = button.dataset.copyIdleText ?? 'Copy'
		}, 1200)
	})
}

export const setCopyButton = (root: ParentNode, selector: string, value: string, label: string) => {
	const button = root.querySelector<HTMLButtonElement>(selector)
	if (!button || !value) return
	button.hidden = false
	button.dataset.copyValue = value
	button.setAttribute('aria-label', label)
}

export const restrictToDigits = (input: HTMLInputElement) => {
	input.addEventListener('input', () => {
		const cleaned = input.value.replace(/[^\d]/g, '')
		if (cleaned !== input.value) input.value = cleaned
	})
}

let horizontalArrowController: AbortController | null = null

export const bindHorizontalArrows = (navigate: (direction: -1 | 1) => boolean) => {
	horizontalArrowController?.abort()
	const controller = new AbortController()
	horizontalArrowController = controller
	window.addEventListener('keydown', (event) => {
		if (
			(event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey
		) return
		const target = event.target
		if (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		) return
		const direction = event.key === 'ArrowRight' ? 1 : -1
		if (navigate(direction)) event.preventDefault()
	}, { signal: controller.signal })
}
