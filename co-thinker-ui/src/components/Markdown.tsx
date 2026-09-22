import { Fragment, type ReactNode } from 'react'
import { parse, type Block, type Inline } from '../domain/markdown'
import { OFFSET_ATTR } from '../domain/reference'

// 只从解析结果构造元素，没有 raw HTML 通道。文本 run 带 data-o 供选区还原偏移。

function inline(nodes: Inline[], keyPrefix = ''): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`
    switch (node.kind) {
      case 'text':
        return (
          <span key={key} {...{ [OFFSET_ATTR]: node.start }}>
            {node.value}
          </span>
        )
      case 'code':
        return (
          <code key={key} {...{ [OFFSET_ATTR]: node.start }}>
            {node.value}
          </code>
        )
      case 'strong':
        return <strong key={key}>{inline(node.children, `${key}-`)}</strong>
      case 'em':
        return <em key={key}>{inline(node.children, `${key}-`)}</em>
      case 'link':
        return (
          <a key={key} href={node.href} target="_blank" rel="noreferrer noopener">
            {inline(node.children, `${key}-`)}
          </a>
        )
    }
  })
}

function block(node: Block, key: string): ReactNode {
  switch (node.kind) {
    case 'p':
      return <p key={key}>{inline(node.children, `${key}-`)}</p>
    case 'h':
      return node.level === 2 ? (
        <h2 key={key}>{inline(node.children, `${key}-`)}</h2>
      ) : (
        <h3 key={key}>{inline(node.children, `${key}-`)}</h3>
      )
    case 'quote':
      return (
        <blockquote key={key}>{node.blocks.map((b, i) => block(b, `${key}-${i}`))}</blockquote>
      )
    case 'list': {
      const items = node.items.map((item, i) => <li key={i}>{inline(item, `${key}-${i}-`)}</li>)
      return node.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
    }
    case 'pre':
      return (
        <pre key={key}>
          <code {...{ [OFFSET_ATTR]: node.start }}>{node.value}</code>
        </pre>
      )
    case 'hr':
      return <hr key={key} />
    case 'table':
      return (
        <div className="table-wrap" key={key} tabIndex={0} role="group" aria-label="表格，可横向滚动">
          <table>
            <thead>
              <tr>
                {node.head.map((cell, i) => (
                  <th key={i}>{inline(cell, `${key}-h${i}-`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{inline(cell, `${key}-${r}-${c}-`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

export function Markdown({ source }: { source: string }) {
  const { blocks } = parse(source)
  return <Fragment>{blocks.map((b, i) => block(b, String(i)))}</Fragment>
}
