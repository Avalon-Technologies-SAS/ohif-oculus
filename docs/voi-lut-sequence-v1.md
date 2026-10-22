# VOI LUT Sequence (0028,3010) en OHIF — Decisiones y límites v1

## Resumen

OHIF ahora aplica la VOI LUT no lineal (VOILUTSequence, tag 0028,3010) pixel a
pixel durante la carga de la imagen, para que estudios CR/DX/MG sin
WindowCenter/WindowWidth (o con LUT no lineal) se visualicen con el contraste
previsto por la modalidad. La implementación vive en `platform/core` y se
activa desde `extension-default`; no se modificó `extension-cornerstone` ni
ningún paquete `@cornerstonejs/*`.

## Componentes

| Componente | Ubicación |
| --- | --- |
| Parser de VOILUTSequence | `platform/core/src/utils/voiLutSequence/parseVOILUTSequence.ts` |
| Remapeo pixel a pixel | `platform/core/src/utils/voiLutSequence/applyVOILUTToPixelData.ts` |
| Hook de loader (wrapper) | `platform/core/src/utils/voiLutSequence/registerVOILUTSequenceImageLoader.ts` |
| Activación | `extensions/default/src/index.ts` (`onModeEnter`) |

## Política funcional v1 (Paso 1 del plan)

- Si existe una VOILUTSequence válida, se aplica el **primer item** de la
  secuencia. No hay selector UI de múltiples items.
- Si coexisten WindowCenter/WindowWidth y VOILUTSequence, **se prefiere la
  VOILUTSequence**. No hay alternador UI entre LUT y WC/WW.
- Elegibilidad restringida para reducir riesgo:
  - Modalidades: `CR`, `DX`, `MG`.
  - `PhotometricInterpretation` MONOCHROME1/MONOCHROME2 y `SamplesPerPixel` 1.
- Las imágenes sin VOILUTSequence (o no elegibles, o con LUT inválida) siguen
  el flujo actual sin ninguna alteración: ante cualquier error el wrapper
  devuelve la imagen original.

## Cómo funciona

1. `registerVOILUTSequenceImageLoader(classes.MetadataProvider)` re-registra
   los esquemas `wadors`, `wadouri`, `dicomweb` y `dicomfile` con un wrapper
   que delega en los `loadImage` públicos de
   `@cornerstonejs/dicom-image-loader` (API pública, sin parches).
2. Al resolver la promesa del loader, se resuelve la instancia por `imageId`
   vía `MetadataProvider.getInstance` y, si es elegible, se remapea el
   pixelData a través de la LUT (transformación determinística, sin
   aproximación lineal/sigmoide).
3. Clipping según PS3.3 C.11.2: valores < `firstMapped` toman la primera
   entrada; valores por encima del último valor mapeable, la última.
4. La entrada de la VOI LUT es la salida de la Modality LUT: si el loader no
   pre-escaló los píxeles, se aplica `slope/intercept` antes de indexar; tras
   el remapeo la imagen queda con `slope=1, intercept=0`.
5. Metadata del `IImage` ajustada post-transformación (Paso 6 del plan):
   `minPixelValue`/`maxPixelValue` al rango real de salida, y
   `windowCenter`/`windowWidth` identidad sobre ese rango. Cornerstone usa esos
   campos del objeto imagen tanto para el VOI inicial como para el reset, por
   lo que "Reset" vuelve a un estado consistente post-LUT.

## Fuente de la LUT

El wrapper resuelve la VOILUTSequence en este orden:

1. **Metadata OHIF** de la instancia (`DicomMetadataStore`: DICOMweb JSON o
   DICOM JSON). Es el comportamiento original de v1.
2. **Dataset P10 cacheado por el loader `wadouri`**
   (`dicomImageLoader.wadouri.dataSetCacheManager`), cuando la metadata OHIF no
   trae la secuencia. Es el caso del modo **dicomjson**: el JSON (p. ej. el que
   genera Oculus) no incluye la VOILUTSequence, pero el archivo completo sí se
   descarga por WADO-URI (`dicomweb:`/`wadouri:`). Se arma una pseudo-instancia
   naturalizada (`LUTDescriptor` + `LUTData` como vista sobre los bytes OW) y se
   reutiliza el mismo parser.

Para la elegibilidad (modalidad, fotometría, samples per pixel) mandan los
valores de la metadata OHIF; si faltan, se usan los del dataset.

Límites del fallback:

- Solo aplica a imágenes cargadas por `wadouri`/`dicomweb`/`dicomfile`. Con
  `wadors` no hay dataset P10, así que si la metadata DICOMweb no trae la
  secuencia la imagen sigue sin LUT.
- Se asume LUTData little-endian (todas las sintaxis de transferencia vigentes;
  Explicit VR Big Endian está retirada).

## Decisiones técnicas relevantes

- **Activación en `onModeEnter` y no en `preRegistration` de
  extension-default**: extension-default se registra antes que
  extension-cornerstone, y `dicomImageLoader.init()` (invocado en el
  `preRegistration` de cornerstone) re-registra los esquemas, lo que habría
  sobrescrito los wrappers. `onModeEnter` de las extensiones corre después de
  todos los `preRegistration` y antes de que los viewports del modo carguen
  imágenes, que es la garantía que pedía el plan. El registrador es
  idempotente (solo envuelve una vez).
- **Transformación una sola vez por imagen/frame**: la cache de imágenes de
  Cornerstone conserva el resultado del loader, así que el remapeo ocurre una
  única vez por `imageId` mientras la imagen esté cacheada. Además se cachea la
  LUT parseada por instancia (WeakMap) para no re-parsear en recargas tras
  evicción de cache o entre frames que comparten instancia.
- **Formatos de LUTData soportados**: array numérico, `Uint8Array`/
  `Uint16Array`/`ArrayBuffer`, base64 (`InlineBinary`) con payload OW 16-bit
  little-endian, y LUTs de 8 bits con una entrada por byte o por palabra.
  `LUTDescriptor[0] = 0` se interpreta como 65536 entradas y
  `LUTDescriptor[1]` se interpreta como signed cuando `PixelRepresentation=1`.

## Límites conocidos de v1

- **Sin UI**: no hay selector de items de VOILUTSequence ni alternador
  LUT ↔ WC/WW. Siempre se usa el primer item.
- **Probe y herramientas de valor**: muestran el **valor post-transformación**
  (salida de la LUT), no el valor almacenado original. Lo mismo aplica a
  estadísticas de ROI sobre estas imágenes. Es una consecuencia aceptada de
  transformar el pixelData en carga.
- **`LUTData` referenciada por `BulkDataURI` no soportada**: requeriría una
  petición asíncrona adicional; esas imágenes siguen el flujo actual.
- **Multiframe con VOI LUT por frame** (PerFrameFunctionalGroupsSequence) no
  contemplado; solo la VOILUTSequence a nivel de instancia.
- **Volúmenes/MPR**: las modalidades elegibles (CR/DX/MG) se visualizan como
  stack; si se reconstruyera un volumen a partir de imágenes transformadas,
  éste recibiría los valores post-LUT.
- Ajustar manualmente W/L sobre la imagen transformada opera sobre los valores
  post-LUT (comportamiento esperado: la LUT reemplaza la etapa VOI).

## Fuera de alcance declarado

- Pruebas automatizadas (excluidas explícitamente por el plan).
- Cambios en `extensions/cornerstone/**` o en paquetes `@cornerstonejs/*`
  (verificado: sin diffs en esas rutas).
