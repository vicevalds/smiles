import { clearSharedViewerInput } from './lib/viewer-input'

const initializeForm = () => {
	const form = document.querySelector<HTMLFormElement>('#smiles-form')

	if (!form) return

	const textarea = form.querySelector<HTMLTextAreaElement>('#smiles-text')!
	const file = form.querySelector<HTMLInputElement>('#smiles-file')!
	const renderButton = form.querySelector<HTMLButtonElement>('#render-btn')!
	const cleanButton = form.querySelector<HTMLButtonElement>('#clean-btn')!
	const renderExample = form.querySelector<HTMLButtonElement>('#render-example')!

	const syncExampleState = () => {
		renderExample.disabled = renderButton.disabled
	}

	new MutationObserver(syncExampleState).observe(renderButton, {
		attributes: true,
		attributeFilter: ['disabled'],
	})
	syncExampleState()

	renderExample.addEventListener('click', () => {
		textarea.value = textarea.placeholder
		file.value = ''
		textarea.dispatchEvent(new Event('input', { bubbles: true }))
		form.requestSubmit(renderButton)
	})

	cleanButton.addEventListener('click', () => {
		textarea.value = ''
		file.value = ''
		clearSharedViewerInput()
		textarea.dispatchEvent(new Event('input', { bubbles: true }))
		form.dispatchEvent(new CustomEvent('viewer:clean'))
	})

	textarea.addEventListener('keydown', (event) => {
		if (
			event.key !== 'Enter' ||
			event.shiftKey ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			renderButton.disabled
		) return
		event.preventDefault()
		if (form.dataset.blurOnEnter === 'true') textarea.blur()
		form.requestSubmit(renderButton)
	})
}

document.addEventListener('astro:page-load', initializeForm)

export {}
