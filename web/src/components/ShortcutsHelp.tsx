import { SHORTCUT_GROUPS } from '../editor/TyporaKeys'

// Pure hover reveal (CSS :hover, see .shortcuts-help-wrap in styles.css) —
// no click/open state to manage, matches how a tooltip should behave.
export function ShortcutsHelp() {
  return (
    <span className="shortcuts-help-wrap">
      <button className="icon-btn" title="Keyboard shortcuts" aria-label="Keyboard shortcuts">⌨</button>
      <div className="shortcuts-help-panel">
        {SHORTCUT_GROUPS.map(group => (
          <div key={group.title} className="shortcuts-help-group">
            <h4>{group.title}</h4>
            {group.items.map(item => (
              <div key={item.keys} className="shortcuts-help-row">
                <kbd>{item.keys}</kbd>
                <span>{item.desc}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </span>
  )
}
