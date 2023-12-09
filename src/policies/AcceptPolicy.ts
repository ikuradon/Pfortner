import { type Policy } from '../../mod.ts';

export const acceptPolicy: Policy<void> = (message) => {
  return { message, action: 'accept' };
};
