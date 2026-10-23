import type { CSSProperties } from 'react';
import { EnterCap } from '../../components/Keycap';
import { Icon } from '../../components/Icon';
import { PLACEHOLDER_STYLE, coverStyle, placeholderFor, useImageSize } from './cover';

export interface CardModel {
  id: string;
  name: string;
  meta: string;
  /** Image URL (vx-asset: or blob:) with its focus and zoom, or null for a placeholder. */
  cover: { url: string; focus: { x: number; y: number }; zoom: number } | null;
}

/**
 * One Vault card (design/components/VaultCard). Used by the chooser and, unchanged,
 * by the Vault dialog's live preview.
 */
export function VaultCard({
  card,
  selected,
  onActivate,
  onEdit,
  onSelect,
  editLabel,
  preview,
}: {
  card: CardModel;
  selected: boolean;
  onActivate?: () => void;
  onEdit?: () => void;
  onSelect?: () => void;
  editLabel?: string;
  /** Rendered as a picture only (dialog preview): no button semantics. */
  preview?: boolean;
}) {
  const natural = useImageSize(card.cover?.url ?? null);
  let coverClass = 'vx-card__cover';
  let style: CSSProperties = {};
  if (card.cover && natural) {
    style = coverStyle(card.cover.url, natural, card.cover);
  } else if (!card.cover) {
    coverClass += ` ${placeholderFor(card.id)}`;
    style = PLACEHOLDER_STYLE;
  }
  const inner = (
    <>
      <span className={coverClass} style={style} />
      <span className="vx-card__frost" />
      <span className="vx-card__line" />
      <span className="vx-card__bracket vx-card__bracket--tl" />
      <span className="vx-card__bracket vx-card__bracket--br" />
      <span className="vx-card__text">
        <span className="vx-card__name">{card.name}</span>
        <span className="vx-card__rule" />
        <span className="vx-card__meta">{card.meta}</span>
      </span>
      {selected && !preview && <EnterCap className="vx-card__enter" />}
    </>
  );
  return (
    <div
      className={`vx-card-slot${selected ? ' is-selected' : ''}`}
      data-testid={preview ? 'card-preview' : 'vault-card'}
    >
      {preview ? (
        <div className="vx-card" role="img" aria-label={`${card.name}, ${card.meta}`}>
          {inner}
        </div>
      ) : (
        <button
          type="button"
          className="vx-card"
          aria-label={`${card.name}, ${card.meta}`}
          aria-current={selected ? 'true' : undefined}
          tabIndex={selected ? 0 : -1}
          onClick={() => (selected ? onActivate?.() : onSelect?.())}
          onDoubleClick={onActivate}
        >
          {inner}
        </button>
      )}
      {selected && onEdit && (
        <button
          type="button"
          className="vx-card__edit"
          aria-label={editLabel}
          title="Edit Vault"
          onClick={onEdit}
        >
          <Icon name="pencil" />
        </button>
      )}
    </div>
  );
}

export function NewVaultCard({
  selected,
  onActivate,
  onSelect,
  title,
  hint,
}: {
  selected: boolean;
  onActivate: () => void;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <div className={`vx-card-slot${selected ? ' is-selected' : ''}`} data-testid="new-vault-card">
      <button
        type="button"
        className="vx-card vx-card--new"
        aria-label={title}
        aria-current={selected ? 'true' : undefined}
        tabIndex={selected ? 0 : -1}
        onClick={() => (selected ? onActivate() : onSelect())}
        onDoubleClick={onActivate}
      >
        <span className="vx-card__plus" aria-hidden="true">
          <Icon name="plus" />
        </span>
        <span className="vx-card__new-title">{title}</span>
        <span className="vx-card__new-hint">{hint}</span>
      </button>
    </div>
  );
}
