let sharedViewerInput: string | null = null

export const getSharedViewerInput = () => sharedViewerInput

export const setSharedViewerInput = (input: string) => {
	sharedViewerInput = input
}

export const clearSharedViewerInput = () => {
	sharedViewerInput = null
}
