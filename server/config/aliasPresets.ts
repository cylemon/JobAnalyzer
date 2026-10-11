/**
 * 推荐别名种子（03-architecture.md §4.1）。
 *
 * 只是「常见写法」的起点，不是权威表——用户可在设置页自由增删。
 * 应用某条推荐别名时，系统会真的把已有数据里的旧写法合并到新写法上（见 skillAlias.ts）。
 */
export type AliasPreset = { aliasKey: string; skillKey: string; label: string }

export const ALIAS_PRESETS: AliasPreset[] = [
  { aliasKey: 'k8s', skillKey: 'kubernetes', label: 'K8s → Kubernetes' },
  { aliasKey: 'py', skillKey: 'python', label: 'py → Python' },
  { aliasKey: 'js', skillKey: 'javascript', label: 'js → JavaScript' },
  { aliasKey: 'ts', skillKey: 'typescript', label: 'ts → TypeScript' },
  { aliasKey: 'golang', skillKey: 'go', label: 'Golang → Go' },
  { aliasKey: 'postgres', skillKey: 'postgresql', label: 'postgres → PostgreSQL' },
  { aliasKey: 'node', skillKey: 'node.js', label: 'node → Node.js' },
  { aliasKey: 'nodejs', skillKey: 'node.js', label: 'nodejs → Node.js' },
  { aliasKey: 'react.js', skillKey: 'react', label: 'React.js → React' },
  { aliasKey: 'vue.js', skillKey: 'vue', label: 'Vue.js → Vue' },
  { aliasKey: '大模型', skillKey: 'llm', label: '大模型 → LLM' },
  { aliasKey: '机器学习', skillKey: 'ml', label: '机器学习 → ML' },
  { aliasKey: '深度学习', skillKey: 'dl', label: '深度学习 → DL' },
  { aliasKey: '自然语言处理', skillKey: 'nlp', label: '自然语言处理 → NLP' },
  { aliasKey: 'kafka', skillKey: 'apache kafka', label: 'Kafka → Apache Kafka' },
]
