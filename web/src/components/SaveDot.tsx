import { useGlobalSaveStatus } from '../saveStatus'

const LABEL = {
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Offline — changes cached locally',
  conflict: 'Conflict — please refresh',
}

export function SaveDot() {
  const s = useGlobalSaveStatus()
  return <span className={`save-dot save-${s}`} title={LABEL[s]} />
}
