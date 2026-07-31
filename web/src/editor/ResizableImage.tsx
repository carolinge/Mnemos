import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useRef } from 'react'

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {   // 百分比宽度，null = 原始
        default: null,
        parseHTML: el => {
          const w = (el as HTMLElement).style.width
          return w?.endsWith('%') ? Number(w.slice(0, -1)) : null
        },
        renderHTML: attrs => attrs.width ? { style: `width:${attrs.width}%` } : {},
      },
    }
  },
  addNodeView() { return ReactNodeViewRenderer(ImageView) },
})

function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)

  function startResize(e: React.PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const container = wrapRef.current!.parentElement as HTMLElement
    const total = container.getBoundingClientRect().width
    const move = (ev: PointerEvent) => {
      const rect = wrapRef.current!.getBoundingClientRect()
      const pct = Math.min(Math.max(((ev.clientX - rect.left) / total) * 100, 10), 100)
      updateAttributes({ width: Math.round(pct) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function openLightbox() {
    window.dispatchEvent(new CustomEvent('parchment:lightbox', { detail: node.attrs.src }))
  }

  return (
    <NodeViewWrapper as="div" className={`img-wrap ${selected ? 'selected' : ''}`}
      ref={wrapRef} style={{ width: node.attrs.width ? `${node.attrs.width}%` : undefined }}>
      <img src={node.attrs.src} alt={node.attrs.alt ?? ''} onClick={openLightbox} draggable={false} />
      <span className="img-handle" onPointerDown={startResize} title="拖动调整大小" />
    </NodeViewWrapper>
  )
}
