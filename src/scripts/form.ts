const form = document.querySelector<HTMLFormElement>('#smiles-form')

if (form) {
	const textarea = form.querySelector<HTMLTextAreaElement>('#smiles-text')!
	const file = form.querySelector<HTMLInputElement>('#smiles-file')!
	const renderButton = form.querySelector<HTMLButtonElement>('#render-btn')!
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

export {}
