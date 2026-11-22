// Metro turns an imported image into a numeric asset id, which <Image source>
// accepts. Expo SDK 58 no longer ships these declarations.
declare module '*.png' {
  const asset: number;
  export default asset;
}
