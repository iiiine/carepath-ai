// A missing ID never means that a member's result was saved.
export function summaryMode(result, isGuest) {
  if (!result || result.save_status === 'failed') return 'unavailable';
  if (isGuest) return result.save_status === 'saved' ? 'unavailable' : 'local';
  if (result.save_status === 'not_applicable') return 'unavailable';
  return result.session_id != null && String(result.session_id).trim() !== '' ? 'saved' : 'unavailable';
}
