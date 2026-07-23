type ComposerDraftDiscardListener = (draftKey: string) => void;

const discardListeners = new Set<ComposerDraftDiscardListener>();

export function notifyComposerDraftDiscarded(draftKey: string) {
  for (const listener of discardListeners) listener(draftKey);
}

export function subscribeComposerDraftDiscard(listener: ComposerDraftDiscardListener) {
  discardListeners.add(listener);
  return () => discardListeners.delete(listener);
}
