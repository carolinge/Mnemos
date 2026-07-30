import { useGlobalSaveStatus } from '../saveStatus'

const LABEL = { saved: '已保存', saving: '保存中…', offline: '离线，改动已缓存', conflict: '有冲突，请刷新' }

export function SaveDot() {
  const s = useGlobalSaveStatus()
  return <span className={`save-dot save-${s}`} title={LABEL[s]} />
}
