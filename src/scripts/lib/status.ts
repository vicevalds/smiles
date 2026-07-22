const DONE_MESSAGE = 'Downloading RDKit, done.'
const VISIBLE_DURATION = 3000
const FADE_DURATION = 2000

export const createStatusController = (element: HTMLElement) => {
	let fadeTimer: number | undefined
	let clearTimer: number | undefined

	const clear = () => {
		if (fadeTimer !== undefined) window.clearTimeout(fadeTimer)
		if (clearTimer !== undefined) window.clearTimeout(clearTimer)
		fadeTimer = undefined
		clearTimer = undefined
		element.textContent = ''
		element.hidden = true
		delete element.dataset.fading
	}

	const show = (message: string) => {
		if (fadeTimer !== undefined) window.clearTimeout(fadeTimer)
		if (clearTimer !== undefined) window.clearTimeout(clearTimer)
		fadeTimer = undefined
		clearTimer = undefined
		delete element.dataset.fading
		element.textContent = message
		element.hidden = false
		if (message !== DONE_MESSAGE) return
		fadeTimer = window.setTimeout(() => {
			fadeTimer = undefined
			void element.offsetWidth
			element.dataset.fading = 'true'
			clearTimer = window.setTimeout(clear, FADE_DURATION)
		}, VISIBLE_DURATION)
	}

	return { show, clear }
}
