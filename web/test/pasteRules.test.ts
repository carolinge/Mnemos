import { describe, it, expect } from 'vitest'
import { pickImageFiles } from '../src/editor/pasteRules'

function fakeFile(type: string, name = 'f') { return new File([new Uint8Array([1])], name, { type }) }

describe('pickImageFiles', () => {
  it('过滤出图片文件', () => {
    const files = [fakeFile('image/png'), fakeFile('text/plain'), fakeFile('image/jpeg')]
    expect(pickImageFiles(files).map(f => f.type)).toEqual(['image/png', 'image/jpeg'])
  })
  it('无图片返回空数组', () => {
    expect(pickImageFiles([fakeFile('application/pdf')])).toEqual([])
  })
})
