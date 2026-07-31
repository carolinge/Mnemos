// 与后端 classifyUrl 的「学术源」子集保持一致：只有这些域触发引用卡片
const CITE_RE = [
  /^https?:\/\/(dx\.)?doi\.org\/10\.\d{4,9}\/\S+$/i,
  /^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\/\d{4}\.\d{4,5}(v\d+)?\/?$/i,
  /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/?$/i,
]

export function isCitationUrl(text: string): boolean {
  const t = text.trim()
  return CITE_RE.some(re => re.test(t))
}
