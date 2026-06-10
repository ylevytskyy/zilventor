import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomTextureDef } from '@zilventor/shared';
import { downscaleToJpeg, decodeImageFile } from '../textures/downscaleTexture';
import type { DrawableSource } from '../textures/downscaleTexture';

export interface UploadSubmitPayload {
  def: CustomTextureDef;
  bytes: Record<string, Uint8Array>;
}

export interface UploadCustomTextureDialogProps {
  onSubmit: (payload: UploadSubmitPayload) => void;
  onCancel: () => void;
  /** Injected for tests — defaults to the real decodeImageFile. */
  _decodeImageFile?: (file: File) => Promise<DrawableSource>;
  /** Injected for tests — defaults to the real downscaleToJpeg. */
  _downscaleToJpeg?: (src: DrawableSource) => Promise<Uint8Array>;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
};

const panelStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #444',
  borderRadius: 6,
  padding: 16,
  width: 420,
  color: '#eee',
  fontSize: 12,
};

const fieldRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 6,
};

const labelStyle: React.CSSProperties = { width: 140, fontSize: 11, flexShrink: 0 };

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: '#222',
  border: '1px solid #444',
  color: '#eee',
  padding: '4px 6px',
  fontSize: 11,
};

const btnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: 11,
};

const okBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#3b5a8a',
  borderColor: '#6a8ec4',
};

const errorStyle: React.CSSProperties = {
  background: '#3a1a1a',
  border: '1px solid #6a3333',
  color: '#ffb3b3',
  padding: '4px 8px',
  borderRadius: 4,
  fontSize: 11,
  marginTop: 6,
};

export function UploadCustomTextureDialog({
  onSubmit,
  onCancel,
  _decodeImageFile: decodeFn = decodeImageFile,
  _downscaleToJpeg: downscaleFn = downscaleToJpeg,
}: UploadCustomTextureDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = React.useState('');
  const [albedoFile, setAlbedoFile] = React.useState<File | null>(null);
  const [normalFile, setNormalFile] = React.useState<File | null>(null);
  const [roughnessFile, setRoughnessFile] = React.useState<File | null>(null);
  const [widthMm, setWidthMm] = React.useState('1000');
  const [heightMm, setHeightMm] = React.useState('1000');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canAdd = name.trim().length > 0 && albedoFile !== null && !busy;

  const onAdd = async () => {
    if (!albedoFile) return;
    setBusy(true);
    setError(null);
    try {
      const bytes: Record<string, Uint8Array> = {};

      async function processFile(file: File): Promise<string> {
        const blobId = 'tex-' + crypto.randomUUID();
        const src = await decodeFn(file);
        const data = await downscaleFn(src);
        bytes[blobId] = data;
        return blobId;
      }

      const albedoBlobId = await processFile(albedoFile);
      const normalBlobId = normalFile ? await processFile(normalFile) : undefined;
      const roughnessBlobId = roughnessFile ? await processFile(roughnessFile) : undefined;

      const def: CustomTextureDef = {
        id: 'custom-' + crypto.randomUUID(),
        name: name.trim(),
        physicalWidthMm: Number(widthMm) || 1000,
        physicalHeightMm: Number(heightMm) || 1000,
        albedoBlobId,
        ...(normalBlobId ? { normalBlobId } : {}),
        ...(roughnessBlobId ? { roughnessBlobId } : {}),
      };

      onSubmit({ def, bytes });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div style={overlayStyle} role="dialog" aria-label={t('dialog.uploadTexture.ariaLabel')} aria-modal="true">
      <div style={panelStyle}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{t('dialog.uploadTexture.title')}</div>

        <div style={fieldRow}>
          <label htmlFor="uct-name" style={labelStyle}>{t('dialog.uploadTexture.textureName')}</label>
          <input
            id="uct-name"
            aria-label={t('dialog.uploadTexture.textureNameAria')}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            disabled={busy}
          />
        </div>

        <div style={fieldRow}>
          <label htmlFor="uct-albedo" style={labelStyle}>{t('dialog.uploadTexture.albedo')}</label>
          <input
            id="uct-albedo"
            aria-label={t('dialog.uploadTexture.albedoAria')}
            type="file"
            accept="image/*"
            required
            onChange={(e) => setAlbedoFile(e.target.files?.[0] ?? null)}
            style={inputStyle}
            disabled={busy}
          />
        </div>

        <div style={fieldRow}>
          <label htmlFor="uct-normal" style={labelStyle}>{t('dialog.uploadTexture.normal')}</label>
          <input
            id="uct-normal"
            aria-label={t('dialog.uploadTexture.normalAria')}
            type="file"
            accept="image/*"
            onChange={(e) => setNormalFile(e.target.files?.[0] ?? null)}
            style={inputStyle}
            disabled={busy}
          />
        </div>

        <div style={fieldRow}>
          <label htmlFor="uct-roughness" style={labelStyle}>{t('dialog.uploadTexture.roughness')}</label>
          <input
            id="uct-roughness"
            aria-label={t('dialog.uploadTexture.roughnessAria')}
            type="file"
            accept="image/*"
            onChange={(e) => setRoughnessFile(e.target.files?.[0] ?? null)}
            style={inputStyle}
            disabled={busy}
          />
        </div>

        <div style={fieldRow}>
          <label htmlFor="uct-width" style={labelStyle}>{t('dialog.uploadTexture.physicalWidth')}</label>
          <input
            id="uct-width"
            aria-label={t('dialog.uploadTexture.physicalWidthAria')}
            type="number"
            min="1"
            value={widthMm}
            onChange={(e) => setWidthMm(e.target.value)}
            style={inputStyle}
            disabled={busy}
          />
        </div>

        <div style={fieldRow}>
          <label htmlFor="uct-height" style={labelStyle}>{t('dialog.uploadTexture.physicalHeight')}</label>
          <input
            id="uct-height"
            aria-label={t('dialog.uploadTexture.physicalHeightAria')}
            type="number"
            min="1"
            value={heightMm}
            onChange={(e) => setHeightMm(e.target.value)}
            style={inputStyle}
            disabled={busy}
          />
        </div>

        {error && <div role="alert" style={errorStyle}>{error}</div>}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" style={btnStyle} onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={okBtnStyle}
            onClick={onAdd}
            disabled={!canAdd}
          >
            {t('dialog.uploadTexture.addTexture')}
          </button>
        </div>
      </div>
    </div>
  );
}
