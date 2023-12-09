import { type Policy } from '../pfortner.ts';

export const acceptPolicy: Policy<void> = (message) => {
  return { message, action: 'accept' };
};
