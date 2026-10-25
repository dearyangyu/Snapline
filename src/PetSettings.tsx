import { useId, useMemo, useState } from 'react';
import { Check, GripVertical, LayoutGrid, Sparkles } from './icons';
import IslandPet from './IslandPet';
import PetAvatar from './PetAvatar';
import { PET_CATALOG, normalizeIslandPets, type PetId } from './petCatalog';
import { islandPetsForCount, replaceIslandPet, type Settings } from './model';
import './petSettings.css';

interface Props {
  settings: Settings;
  disabled?: boolean;
  onChange: (patch: Partial<Settings>) => void | Promise<void>;
}

export default function PetSettings({ settings, disabled = false, onChange }: Props) {
  const titleId = useId();
  const pets = useMemo(() => normalizeIslandPets(settings.islandPets), [settings.islandPets]);
  const interactions = settings.islandPetInteractions ?? true;
  const [selectedSlot, setSelectedSlot] = useState(0);
  const slot = Math.min(selectedSlot, pets.length - 1);
  const current = pets[slot];
  const nameOf = (id: PetId) => PET_CATALOG.find(pet => pet.id === id)!.name;
  const changeCount = (count: 1 | 2 | 3) => {
    if (disabled || count === pets.length) return;
    setSelectedSlot(count > pets.length ? pets.length : Math.min(slot, count - 1));
    void onChange({ islandPets: islandPetsForCount(pets, count) });
  };
  const choose = (id: PetId) => {
    if (disabled || id === current || pets.includes(id)) return;
    void onChange({ islandPets: replaceIslandPet(pets, slot, id) });
  };

  return <section className="settings-section pet-settings" aria-labelledby={titleId} aria-busy={disabled}>
    <div className="section-heading"><Sparkles size={19} /><h2 id={titleId}>灵动岛角色</h2></div>
    <p className="section-description">选择数量，再为每个位置选择角色。</p>

    <div className="pet-settings-preview">
      <div className="pet-preview-island" role="img" aria-label={`顶部入口预览：${pets.map(nameOf).join('、')}`}>
        <span className="pet-preview-grip" aria-hidden="true"><GripVertical size={14} /></span>
        <span className="pet-preview-stage"><IslandPet pets={pets} interactions={interactions} /></span>
        <span className="pet-preview-gallery" aria-hidden="true"><LayoutGrid size={16} /></span>
      </div>
      <span className="pet-preview-caption">实时预览 · {pets.length} 个角色</span>
    </div>

    <div className="setting-row pet-count-row">
      <div><strong>角色数量</strong></div>
      <div className="segmented pet-count" role="group" aria-label="角色数量">
        {([1, 2, 3] as const).map(count => <button key={count} type="button" disabled={disabled}
          aria-pressed={pets.length === count} className={pets.length === count ? 'active' : ''}
          onClick={() => changeCount(count)}>{count} 个</button>)}
      </div>
    </div>

    <div className="pet-slots" role="group" aria-label="选择要更换的位置">
      {pets.map((id, index) => <button key={index} type="button" className={`pet-slot${slot === index ? ' is-active' : ''}`}
        disabled={disabled} aria-pressed={slot === index} aria-label={`位置 ${index + 1}：${nameOf(id)}`}
        onClick={() => setSelectedSlot(index)}>
        <PetAvatar petId={id} className="pet-slot-avatar" />
        <span><small>位置 {index + 1}</small><strong>{nameOf(id)}</strong></span>
      </button>)}
    </div>

    <div className="pet-catalog" role="group" aria-label={`为位置 ${slot + 1} 选择角色`}>
      {PET_CATALOG.map(pet => {
        const selected = pet.id === current;
        const assigned = pets.indexOf(pet.id);
        const elsewhere = assigned >= 0 && !selected;
        return <button key={pet.id} type="button" className={`pet-choice${selected ? ' is-selected' : ''}`}
          disabled={disabled || elsewhere} aria-pressed={selected}
          aria-label={`${pet.name}，${pet.description}${elsewhere ? `，已在位置 ${assigned + 1}` : ''}`}
          title={pet.description} onClick={() => choose(pet.id)}>
          <PetAvatar petId={pet.id} className="pet-choice-avatar" />
          <strong>{pet.name}</strong>
          <span className="pet-choice-description">{pet.temperament}</span>
          <span className="pet-choice-assignment">{elsewhere ? `已在位置 ${assigned + 1}` : selected ? '已选择' : '\u00a0'}</span>
          {selected && <Check className="pet-choice-check" size={15} aria-hidden="true" />}
        </button>;
      })}
    </div>

    <div className="setting-row pet-interactions-row">
      <div><strong>角色互动</strong><p>多个角色相遇时互相回应。</p></div>
      <button type="button" role="switch" className={`toggle${interactions ? ' on' : ''}`}
        disabled={disabled} aria-label="角色互动" aria-checked={interactions}
        onClick={() => { if (!disabled) void onChange({ islandPetInteractions: !interactions }); }}><span /></button>
    </div>
  </section>;
}
