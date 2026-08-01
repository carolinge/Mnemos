import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

// 代码块右上角的语言选择器，仿 Typora。列表与 extensions.ts 里注册给 lowlight 的语言一致。
export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: '', label: 'Plain text' },
  { value: 'python', label: 'Python' },
  { value: 'r', label: 'R' },
  { value: 'matlab', label: 'MATLAB' },
  { value: 'cpp', label: 'C / C++' },
  { value: 'bash', label: 'Shell' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'sql', label: 'SQL' },
  { value: 'latex', label: 'LaTeX' },
]

export function CodeBlockView({ node, updateAttributes, extension }: NodeViewProps) {
  const current: string = node.attrs.language || ''
  // 导入的旧笔记可能带我们没注册的语言，补一个临时选项，避免下拉显示成空白
  const known = CODE_LANGUAGES.some(l => l.value === current)
  const options = known ? CODE_LANGUAGES : [...CODE_LANGUAGES, { value: current, label: current }]

  return (
    <NodeViewWrapper as="div" className="code-block">
      <select className="code-lang" contentEditable={false} value={current}
        title="Language (affects highlighting and export)"
        onChange={e => updateAttributes({ language: e.target.value || null })}>
        {options.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
      <pre spellCheck={false}>
        <NodeViewContent as="code" className={extension.options.languageClassPrefix + current} />
      </pre>
    </NodeViewWrapper>
  )
}
