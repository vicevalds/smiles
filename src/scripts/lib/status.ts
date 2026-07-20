const DONE_MESSAGE = 'Downloading RDKit, done.'
const FADE_DURATION = 2000

export const createStatusController = (element: HTMLElement) => {
	let fadeTimer: number | undefined

	const clear = () => {
		if (fadeTimer !== undefined) window.clearTimeout(fadeTimer)
		fadeTimer = undefined
		element.textContent = ''
		element.hidden = true
		delete element.dataset.fading
	}

	const show = (message: string) => {
		if (fadeTimer !== undefined) window.clearTimeout(fadeTimer)
		fadeTimer = undefined
		delete element.dataset.fading
		element.textContent = message
		element.hidden = false
		if (message !== DONE_MESSAGE) return
		void element.offsetWidth
		element.dataset.fading = 'true'
		fadeTimer = window.setTimeout(clear, FADE_DURATION)
	}

	return { show, clear }
}
