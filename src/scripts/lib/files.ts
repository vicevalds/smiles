export const MAX_FILE_SIZE = 20 * 1048576

export const formatMB = (bytes: number) => (bytes / 1048576).toFixed(1)

export const isAllowedFile = (file: File, extensions: readonly string[]) =>
	extensions.some((ext) => file.name.toLowerCase().endsWith(ext))

export const readTextInput = async (
	textarea: HTMLTextAreaElement,
	fileInput: HTMLInputElement,
	extensions: readonly string[],
) => {
	const pasted = textarea.value.trim()
	if (pasted) return pasted

	const file = fileInput.files?.[0]
	if (!file) return ''
	if (!isAllowedFile(file, extensions)) {
		throw new Error(`Upload a ${extensions.join(', ')} file.`)
	}
	if (file.size > MAX_FILE_SIZE) {
		throw new Error(`File is too large (${formatMB(file.size)} MB). Max is ${formatMB(MAX_FILE_SIZE)} MB.`)
	}

	const text = await file.text()
	textarea.value = text
	return text.trim()
}
