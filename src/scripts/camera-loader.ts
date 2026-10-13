document.addEventListener('astro:page-load', () => {
	const button = document.querySelector<HTMLButtonElement>('#camera-mode-toggle')
	if (!button) return
	let mode: { toggle: () => void } | undefined
	button.addEventListener('click', async () => {
		button.disabled = true
		try {
			mode ??= (await import('@/scripts/camera-mode')).initializeCameraMode(button)
			mode.toggle()
		} catch (error) {
			window.alert(error instanceof Error ? error.message : 'Unable to load Camera Mode.')
		} finally {
			button.disabled = false
		}
	})
})
