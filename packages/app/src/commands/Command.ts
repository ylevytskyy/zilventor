export type Command = {
  readonly name: string;
  apply(): Promise<void>;
  revert(): Promise<void>;
};
