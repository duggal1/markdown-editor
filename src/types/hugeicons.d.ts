// Upstream individual icon entrypoints may omit .d.ts files. The icon values use the official renderer's icon prop type.
declare module '@hugeicons/core-free-icons/*' {
  const icon: import('react').ComponentProps<typeof import('@hugeicons/react').HugeiconsIcon>['icon'];
  export default icon;
}
