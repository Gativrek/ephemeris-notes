import type { Domain } from '@shared/bridge';
import type { IconName } from '../components/Icon';

export const DOMAIN_ORDER: Domain[] = ['academic', 'work', 'personal'];

export const domainStrings: Record<
  Domain,
  { name: string; icon: IconName; color: string; band: string; soft: string }
> = {
  academic: {
    name: 'Academic',
    icon: 'academic',
    color: 'var(--domain-academic)',
    band: 'var(--domain-academic-band)',
    soft: 'var(--domain-academic-soft)',
  },
  work: {
    name: 'Work',
    icon: 'work',
    color: 'var(--domain-work)',
    band: 'var(--domain-work-band)',
    soft: 'var(--domain-work-soft)',
  },
  personal: {
    name: 'Personal',
    icon: 'personal',
    color: 'var(--domain-personal)',
    band: 'var(--domain-personal-band)',
    soft: 'var(--domain-personal-soft)',
  },
};
