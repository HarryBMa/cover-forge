import { useRef, useState } from 'react';
import { useAppDispatch, useAppState, useSelectedItem } from '../../context/AppContext';
import type { ImageRef } from '../../types/editor';
import { MAX_SLEEVE_ROWS, PEGI_RATINGS, type PegiRating, type SleeveCopy, type SleeveRow } from '../../types/sleeve';
import { libraryImages } from '../../engine/imageLibrary';
import { sleeveOf } from '../../engine/gamepak';
import { readImageFile } from '../../api/upload';
import { srcOf } from '../../storage/localImages';

/** One summary line for the sleeve section. */
export function SleeveSummary() {
  const item = useSelectedItem();
  const { banner } = useAppState();
  if (!item) return null;
  if (!banner) return <span>Turn on Branded to show the PC GamePak layout.</span>;
  const s = sleeveOf(item);
  const parts = [s.headline.split('\n')[0] || 'No headline', `${s.rows.length} ${s.rows.length === 1 ? 'row' : 'rows'}`, s.rating ? `PEGI ${s.rating}` : 'no rating'];
  return <span>{parts.join(' · ')}</span>;
}

/** Picks one image from the item's library (or none). */
function ImagePick({ label, value, onPick }: { label: string; value: ImageRef | null; onPick: (r: ImageRef | null) => void }) {
  const item = useSelectedItem()!;
  return (
    <div className="field">
      <span>{label}</span>
      <div className="thumbs sleeve-thumbs">
        <button className={`thumb none ${value === null ? 'selected' : ''}`} aria-pressed={value === null} onClick={() => onPick(null)}>
          None
        </button>
        {libraryImages(item).map((img) => (
          <button key={img.ref} className={`thumb ${img.ref === value ? 'selected' : ''}`} title={img.label} aria-label={`${label}: ${img.label}`} aria-pressed={img.ref === value} onClick={() => onPick(img.ref)}>
            <img src={srcOf(img.url)} alt="" loading="lazy" crossOrigin="anonymous" />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The words and pictures of the PC GamePak sleeve (the cartridge template's Branded layout). They belong to the item,
 * like its title: each game's sleeve says its own thing. Images come from the item's library, which "Add images" extends.
 */
export function SleeveControls() {
  const item = useSelectedItem()!;
  const { banner } = useAppState();
  const dispatch = useAppDispatch();
  const s = sleeveOf(item);
  const patch = (p: Partial<SleeveCopy>) => dispatch({ type: 'updateSleeve', id: item.id, patch: p });
  const setRow = (i: number, p: Partial<SleeveRow>) => patch({ rows: s.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    try {
      const urls = await Promise.all(Array.from(files).map((f) => readImageFile(f)));
      urls.forEach((url) => dispatch({ type: 'addAsset', id: item.id, url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t add that image');
    }
  }

  return (
    <div className="sleeve-controls">
      {!banner && (
        <p className="muted">
          The sleeve layout is drawn when Branded is on.{' '}
          <button className="link" onClick={() => dispatch({ type: 'setBanner', banner: true })}>
            Turn it on
          </button>
        </p>
      )}
      <div className="field row">
        <button onClick={() => fileInput.current?.click()}>Add images…</button>
        <span className="muted">Logos and screenshots for this sleeve.</span>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden aria-label="Upload sleeve images" onChange={(e) => (void upload(e.target.files), (e.target.value = ''))} />
      </div>
      {error && <p className="error small">{error}</p>}

      <h3 className="group-label">Front</h3>
      <ImagePick label="Title logo" value={s.titleLogo} onPick={(titleLogo) => patch({ titleLogo })} />
      <label className="field">
        <span>Tagline</span>
        <input value={s.tagline} placeholder="e.g. the games in a collection" onChange={(e) => patch({ tagline: e.target.value })} />
      </label>
      <label className="field">
        <span>Age rating (PEGI)</span>
        <select value={s.rating ?? ''} onChange={(e) => patch({ rating: (e.target.value || null) as PegiRating | null })}>
          <option value="">None</option>
          {PEGI_RATINGS.map((r) => (
            <option key={r} value={r}>
              PEGI {r}
            </option>
          ))}
        </select>
      </label>

      <h3 className="group-label">Back</h3>
      <label className="field">
        <span>Headline (the last line is drawn in the accent colour)</span>
        <textarea rows={2} value={s.headline} onChange={(e) => patch({ headline: e.target.value })} />
      </label>
      <label className="field">
        <span>Blurb</span>
        <textarea rows={4} value={s.blurb} onChange={(e) => patch({ blurb: e.target.value })} />
      </label>
      {s.rows.map((row, i) => (
        <fieldset key={i} className="sleeve-row">
          <legend>
            Row {i + 1}{' '}
            <button className="link" onClick={() => patch({ rows: s.rows.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </legend>
          <label className="field">
            <span>Title (shown when there’s no logo)</span>
            <input value={row.title} onChange={(e) => setRow(i, { title: e.target.value })} />
          </label>
          <label className="field">
            <span>Text</span>
            <textarea rows={2} value={row.text} onChange={(e) => setRow(i, { text: e.target.value })} />
          </label>
          <ImagePick label="Screenshot" value={row.image} onPick={(image) => setRow(i, { image })} />
          <ImagePick label="Logo" value={row.logo} onPick={(logo) => setRow(i, { logo })} />
        </fieldset>
      ))}
      {s.rows.length < MAX_SLEEVE_ROWS && (
        <button onClick={() => patch({ rows: [...s.rows, { image: null, logo: null, title: '', text: '' }] })}>Add a row</button>
      )}
      <p className="muted small">Rows with no title, text or logo show as a strip of screenshots.</p>
      <label className="field">
        <span>Features line</span>
        <input value={s.features} onChange={(e) => patch({ features: e.target.value })} />
      </label>
      <label className="field">
        <span>Rating note (beside the PEGI label)</span>
        <input value={s.descriptor} placeholder="e.g. Violence" onChange={(e) => patch({ descriptor: e.target.value })} />
      </label>
      <div className="field">
        <span>Publisher logos (drawn in white)</span>
        <div className="thumbs sleeve-thumbs">
          {libraryImages(item).map((img) => {
            const on = s.footerLogos.includes(img.ref);
            return (
              <button
                key={img.ref}
                className={`thumb ${on ? 'selected' : ''}`}
                title={img.label}
                aria-label={`Publisher logo: ${img.label}`}
                aria-pressed={on}
                onClick={() => patch({ footerLogos: on ? s.footerLogos.filter((r) => r !== img.ref) : [...s.footerLogos, img.ref] })}
              >
                <img src={srcOf(img.url)} alt="" loading="lazy" crossOrigin="anonymous" />
              </button>
            );
          })}
        </div>
      </div>
      <label className="field">
        <span>Small print</span>
        <textarea rows={2} value={s.legal} onChange={(e) => patch({ legal: e.target.value })} />
      </label>
      <div className="field row">
        <input type="color" aria-label="Accent colour" value={s.accent} onChange={(e) => patch({ accent: e.target.value })} />
        <span className="muted">Accent colour</span>
      </div>
    </div>
  );
}
