import { X } from 'lucide-react';
import { useRef, useEffect, useState } from 'react';
import type { Settings } from '../../../shared/types';
interface Props {
  settings: Settings;
  onSave(settings: Settings): Promise<void>;
  onClose(): void;
  onError(error: unknown): void;
}
export function SettingsDialog({ settings, onSave, onClose, onError }: Props) {
  const [draft, setDraft] = useState(settings);
  const dialog = useRef<HTMLDialogElement>(null);
  const t = (zh: string, en: string) => (draft.language === 'zh' ? zh : en);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="settings-dialog" onCancel={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(draft).then(onClose).catch(onError);
        }}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">MARKSCAPE</span>
            <h2>{t('偏好设置', 'Preferences')}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t('关闭', 'Close')}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="settings-body">
          <h3>{t('外观与语言', 'Appearance & language')}</h3>
          <label>
            {t('主题', 'Theme')}
            <select
              aria-label={t('主题', 'Theme')}
              value={draft.theme}
              onChange={(e) => setDraft({ ...draft, theme: e.target.value as Settings['theme'] })}
            >
              <option value="system">{t('跟随系统', 'System')}</option>
              <option value="light">{t('浅色', 'Light')}</option>
              <option value="dark">{t('深色', 'Dark')}</option>
              <option value="sepia">{t('暖纸', 'Sepia')}</option>
            </select>
          </label>
          <label>
            {t('语言', 'Language')}
            <select
              aria-label={t('语言', 'Language')}
              value={draft.language}
              onChange={(e) =>
                setDraft({ ...draft, language: e.target.value as Settings['language'] })
              }
            >
              <option value="zh">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {t('字号', 'Font size')}
            <input
              type="number"
              min="12"
              max="28"
              value={draft.fontSize}
              onChange={(e) => setDraft({ ...draft, fontSize: Number(e.target.value) })}
            />
          </label>
          <label>
            {t('行高', 'Line height')}
            <input
              type="number"
              min="1.2"
              max="2.4"
              step="0.1"
              value={draft.lineHeight}
              onChange={(e) => setDraft({ ...draft, lineHeight: Number(e.target.value) })}
            />
          </label>
          <h3>{t('编辑器', 'Editor')}</h3>
          {(['lineNumbers', 'wordWrap', 'autoPairs'] as const).map((key, index) => (
            <label key={key}>
              {t(
                ['显示行号', '自动换行', '自动补全括号'][index],
                ['Line numbers', 'Word wrap', 'Close brackets'][index],
              )}
              <input
                type="checkbox"
                checked={draft.editor[key]}
                onChange={(e) =>
                  setDraft({ ...draft, editor: { ...draft.editor, [key]: e.target.checked } })
                }
              />
            </label>
          ))}
          <label>
            {t('缩进宽度', 'Tab size')}
            <input
              type="number"
              min="1"
              max="8"
              value={draft.editor.tabSize}
              onChange={(e) =>
                setDraft({ ...draft, editor: { ...draft.editor, tabSize: Number(e.target.value) } })
              }
            />
          </label>
          <h3>{t('预览与保存', 'Preview & saving')}</h3>
          {(['math', 'mermaid', 'htmlPassthrough'] as const).map((key, index) => (
            <label key={key}>
              {t(
                ['数学公式', 'Mermaid 图表', '允许 HTML（经安全过滤）'][index],
                ['Math equations', 'Mermaid diagrams', 'Allow sanitized HTML'][index],
              )}
              <input
                type="checkbox"
                checked={draft.preview[key]}
                onChange={(e) =>
                  setDraft({ ...draft, preview: { ...draft.preview, [key]: e.target.checked } })
                }
              />
            </label>
          ))}
          <label>
            {t('自动保存', 'Auto save')}
            <select
              value={draft.files.autoSave}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  files: {
                    ...draft.files,
                    autoSave: e.target.value as Settings['files']['autoSave'],
                  },
                })
              }
            >
              <option value="off">{t('关闭', 'Off')}</option>
              <option value="onFocusChange">{t('失去焦点时', 'On focus change')}</option>
              <option value="afterDelay">{t('延迟保存', 'After delay')}</option>
            </select>
          </label>
          <label>
            {t('保存延迟（毫秒）', 'Save delay (ms)')}
            <input
              type="number"
              min="1000"
              max="60000"
              step="1000"
              value={draft.files.delayMs}
              onChange={(e) =>
                setDraft({ ...draft, files: { ...draft.files, delayMs: Number(e.target.value) } })
              }
            />
          </label>
          <label>
            {t('PDF 纸张', 'PDF page size')}
            <select
              value={draft.export.pdfPageSize}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  export: { ...draft.export, pdfPageSize: e.target.value as 'A4' | 'Letter' },
                })
              }
            >
              <option>A4</option>
              <option>Letter</option>
            </select>
          </label>
          <h3>{t('自定义预览 CSS', 'Custom preview CSS')}</h3>
          <textarea
            className="css-editor"
            aria-label="Custom CSS"
            value={draft.customCss}
            onChange={(e) => setDraft({ ...draft, customCss: e.target.value })}
            placeholder=".markdown-body h1 { color: #3c806b; }"
          />
          <p className="muted">
            {t(
              '本地优先 · 无需登录 · 不上传文档或遥测数据',
              'Local first · No account · No document uploads or telemetry',
            )}
          </p>
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void window.md
                .checkUpdates()
                .then((message) => onError(new Error(message)))
                .catch(onError)
            }
          >
            {t('检查更新', 'Check for updates')}
          </button>
          <button className="primary" type="submit">
            {t('保存设置', 'Save preferences')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
