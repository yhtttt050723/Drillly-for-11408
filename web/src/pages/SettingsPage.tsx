import { useEffect, useState } from 'react'
import { api, type PublicSettings } from '../api'

export function SettingsPage() {
  const [s, setS] = useState<PublicSettings | null>(null)
  const [tongyi, setTongyi] = useState('')
  const [deepseek, setDeepseek] = useState('')
  const [provider, setProvider] = useState('tongyi')
  const [localBaseUrl, setLocalBaseUrl] = useState('http://127.0.0.1:11434/v1')
  const [localModel, setLocalModel] = useState('')
  const [localApiKey, setLocalApiKey] = useState('')
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [msg, setMsg] = useState('')

  const load = () => {
    api.getSettings().then((data) => {
      setS(data)
      setProvider(data.llm_default_provider)
      setLocalBaseUrl(data.local_base_url || 'http://127.0.0.1:11434/v1')
      setLocalModel(data.local_model || '')
    })
    api.listLocalModels().then((r) => setOllamaModels(r.models || [])).catch(() => setOllamaModels([]))
  }

  useEffect(() => {
    load()
  }, [])

  const refreshOllama = () => {
    api.listLocalModels().then((r) => setOllamaModels(r.models || [])).catch(() => setOllamaModels([]))
  }

  const save = async () => {
    setMsg('')
    try {
      const body: Record<string, string | number> = { llm_default_provider: provider }
      if (tongyi.trim()) body.tongyi_api_key = tongyi.trim()
      if (deepseek.trim()) body.deepseek_api_key = deepseek.trim()
      if (localBaseUrl.trim()) body.local_base_url = localBaseUrl.trim()
      body.local_model = localModel.trim()
      if (localApiKey.trim()) body.local_api_key = localApiKey.trim()
      const next = await api.patchSettings(body)
      setS(next)
      setTongyi('')
      setDeepseek('')
      setLocalApiKey('')
      setMsg('已保存；后端会写入 data/settings.json，重启后仍有效。')
      refreshOllama()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <div className="import-page">
      <h2>设置</h2>

      <div className="card">
        <h3>本地模型（Ollama / OpenAI 兼容）</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
          默写单词「AI 补充」默认走本地接口。先在本机运行 Ollama（或 LM Studio 等），再填写模型名。
        </p>
        <p>
          <label>
            API 地址{' '}
            <input
              type="text"
              style={{ width: 360 }}
              placeholder="http://127.0.0.1:11434/v1"
              value={localBaseUrl}
              onChange={(e) => setLocalBaseUrl(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            模型名{' '}
            <input
              type="text"
              style={{ width: 200 }}
              placeholder="如 qwen2.5:7b"
              value={localModel}
              onChange={(e) => setLocalModel(e.target.value)}
              list="ollama-model-list"
            />
          </label>
          <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={refreshOllama}>
            刷新本机模型列表
          </button>
          <datalist id="ollama-model-list">
            {ollamaModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </p>
        {ollamaModels.length > 0 && (
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            检测到：{ollamaModels.slice(0, 8).join('、')}
            {ollamaModels.length > 8 ? ' …' : ''}
          </p>
        )}
        <p>
          <label>
            API Key（可选，Ollama 默认填 ollama）{' '}
            <input
              type="password"
              style={{ width: 200 }}
              placeholder={s?.local_api_key_masked || 'ollama'}
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
            />
          </label>
        </p>
        <p style={{ fontSize: '0.9rem' }}>
          状态：{s?.local_configured ? `已配置 · ${s.local_model}` : '未配置模型名'}
        </p>
      </div>

      <div className="card">
        <h3>云端模型 API Key</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
          留空表示不修改。已配置时显示脱敏：{s?.tongyi_api_key_masked || '—'} /{' '}
          {s?.deepseek_api_key_masked || '—'}
        </p>
        <p>
          <label>
            通义千问 Key{' '}
            <input
              type="password"
              style={{ width: 360 }}
              placeholder={s?.tongyi_configured ? '已配置，输入新 Key 可覆盖' : 'sk-...'}
              value={tongyi}
              onChange={(e) => setTongyi(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            DeepSeek Key{' '}
            <input
              type="password"
              style={{ width: 360 }}
              placeholder={s?.deepseek_configured ? '已配置' : '可选'}
              value={deepseek}
              onChange={(e) => setDeepseek(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            默认模型（PDF 导入等）{' '}
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="local">本地模型</option>
              <option value="tongyi">通义千问</option>
              <option value="deepseek">DeepSeek</option>
              <option value="mock">Mock 测试</option>
            </select>
          </label>
        </p>
        <button type="button" className="btn btn-primary" onClick={save}>
          保存设置
        </button>
        {msg && <p style={{ marginTop: 8 }}>{msg}</p>}
      </div>

      <div className="card">
        <h3>Study 数据目录（与 md-reader-app 共用）</h3>
        <ul style={{ fontSize: '0.9rem', lineHeight: 1.7 }}>
          <li>
            <strong>PDF 待导入</strong>：{s?.pdf_inbox_dir}
            <br />
            将 PDF 放入该文件夹，在「PDF 导入」页一键批量转化。
          </li>
          <li>
            <strong>英文词汇 PDF 待导入</strong>：{s?.english_vocab_inbox_dir}
            <br />
            将「基础词 / 必考词」各 Unit 的 PDF 放入该文件夹，在「导入题目数据 → 默写单词」一键 AI 入库。
          </li>
          <li>
            <strong>错题同步导出</strong>：{s?.study_export_wrongbook}
            <br />
            练习页「同步到 Reader」会生成 <code>### 题目：</code> 格式 md。
          </li>
          <li>
            <strong>视频进度</strong>：{s?.study_video_progress_file}
            <br />
            由 video-dash 写 BV 详情；Reader「视频进度」看板读取。
          </li>
        </ul>
      </div>
    </div>
  )
}
