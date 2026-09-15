# Informe técnico: persistencia de mediciones y segmentaciones en OHIF / Oculus PACS

**Fecha:** 15 de septiembre de 2026  
**Proyecto analizado:** `ohif-oculus`  
**Versión de OHIF:** 3.12.5  
**Alcance:** investigación técnica sin cambios funcionales en OHIF ni en Oculus PACS.

## 1. Resumen ejecutivo

Se identificó por qué el visor no conserva las mediciones, anotaciones y segmentaciones después de cerrar un estudio o abrir otro:

1. Las mediciones y segmentaciones nuevas se mantienen inicialmente en el estado temporal del navegador.
2. Al cambiar de estudio o salir del modo de visualización, OHIF limpia ese estado.
3. Para conservarlo, OHIF debe convertir las mediciones en un objeto **DICOM SR** y las segmentaciones en **DICOM SEG** o **DICOM RT Structure Set (RTSTRUCT/RTSS)**.
4. En la integración actual, los estudios se cargan mediante el datasource `dicomjson`.
5. En OHIF 3.12.5, `dicomjson` permite leer estudios, pero su operación `store.dicom()` no está implementada. Por tanto, no envía el SR, SEG o RTSTRUCT al PACS.
6. El datasource DICOMweb configurado actualmente apunta a un repositorio CloudFront/S3 con `staticWado: true`, diseñado para consulta estática y no para almacenar objetos mediante STOW-RS.

La corrección **no puede resolverse únicamente activando una opción visual de OHIF**. Debe escalarse al equipo responsable de Oculus PACS, backend e infraestructura para disponer de un endpoint de escritura DICOMweb STOW-RS —o de una API/gateway equivalente— y garantizar que los objetos almacenados vuelvan a aparecer al consultar el estudio.

Una vez Oculus PACS cuente con esas capacidades, OHIF deberá configurarse para utilizar el datasource escribible al guardar. La solución recomendada es utilizar DICOMweb para lectura y escritura. Si se conserva `dicomjson` para lectura, también será necesario actualizar dinámicamente el JSON con las nuevas series derivadas o combinarlo con consultas QIDO-RS.

## 2. Comportamiento esperado y comportamiento actual

### 2.1 Comportamiento esperado

Las marcas deben pertenecer únicamente al estudio donde fueron creadas. No deben aparecer al abrir un estudio diferente.

El comportamiento esperado es:

- El usuario crea mediciones o segmentaciones en un estudio.
- El usuario las guarda como objetos DICOM derivados.
- OHIF envía esos objetos al PACS.
- Al cerrar y volver a abrir el **mismo estudio**, OHIF descubre los objetos derivados almacenados.
- OHIF reconstruye —“hidrata”— las mediciones o segmentaciones en el visor.

### 2.2 Comportamiento actual

- Las mediciones aparecen en el panel derecho durante la sesión activa.
- Las segmentaciones aparecen mientras el estudio continúa abierto.
- Al salir del estudio se destruye su estado temporal.
- `dicomjson` vuelve a cargar el documento JSON original, que no contiene los nuevos SR/SEG/RTSTRUCT.
- Como resultado, las marcas dejan de estar disponibles al regresar al estudio.

## 3. Evidencia técnica encontrada

### 3.1 OHIF limpia el estado temporal

Al entrar al modo básico, OHIF limpia las mediciones existentes:

```text
modes/basic/src/index.tsx:139
measurementService.clearMeasurements();
```

Al salir del modo, destruye el servicio de segmentación:

```text
modes/basic/src/index.tsx:207
segmentationService.destroy();
```

Este comportamiento es correcto: evita que anotaciones de un estudio se mezclen con las de otro. La persistencia debe realizarse fuera de la memoria del navegador.

### 3.2 El datasource DICOM JSON no implementa almacenamiento

La implementación local contiene:

```js
store: {
  dicom: () => {
    console.warn(' DICOMJson store dicom not implemented');
  },
},
```

Ubicación:

```text
extensions/default/src/DicomJSONDataSource/index.js:255-259
```

Por ello, cuando `dicomjson` es el datasource activo, OHIF puede generar el objeto DICOM, pero no lo envía a ningún servidor.

### 3.3 Puede presentarse una confirmación engañosa durante la sesión

El flujo de SR ejecuta:

```text
await dataSource.store.dicom(...)
```

y posteriormente agrega el nuevo SR al `DicomMetadataStore` local. Como `dicomjson.store.dicom()` termina sin lanzar error, OHIF puede considerar que la operación finalizó y mostrar el SR temporalmente, aunque no haya sido almacenado en el PACS.

Al recargar el navegador o volver a abrir el estudio, el objeto desaparece porque nunca salió de la memoria local.

### 3.4 El destino DICOMweb incluido actualmente tampoco es escribible

La configuración de Oculus incluida en el repositorio utiliza:

```js
qidoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
wadoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
staticWado: true,
```

Ubicación:

```text
platform/app/public/config/oculus.js:131-139
```

El endpoint está servido mediante CloudFront/Amazon S3 y se comporta como un repositorio estático. No anuncia un servicio STOW-RS para almacenar nuevas instancias.

Agregar únicamente `supportsStow: true` a la configuración no transforma un servidor de lectura en uno de escritura. Esa propiedad describe una capacidad; la capacidad debe existir realmente en el backend.

## 4. Diagnóstico y decisión de escalamiento

### 4.1 Causa raíz

La causa raíz es una incompatibilidad entre el flujo de persistencia que necesita OHIF y las capacidades actuales de los datasources:

| Componente | Capacidad actual | Capacidad requerida |
| --- | --- | --- |
| `dicomjson` | Lectura de un descriptor JSON y de sus instancias | Almacenar DICOM SR/SEG/RTSTRUCT o delegar la escritura |
| CloudFront/S3 `staticWado` | Consulta estática | STOW-RS, actualización de índices y consulta posterior |
| OHIF | Genera SR/SEG/RTSTRUCT y los conserva temporalmente | Un datasource que persista realmente los objetos |
| Oculus PACS/backend | No se ha identificado un endpoint escribible en la configuración actual | Recibir, indexar, consultar y devolver objetos derivados |

### 4.2 ¿Se puede corregir directamente en OHIF?

**No de forma completa.** Una modificación exclusiva en el frontend no puede almacenar datos si el PACS o backend no ofrece una operación de escritura.

OHIF ya incluye la generación de:

- DICOM SR para mediciones y anotaciones compatibles.
- DICOM SEG para segmentaciones de mapa de etiquetas.
- DICOM RTSTRUCT/RTSS para contornos.

Lo que falta es un destino persistente y consultable.

### 4.3 Decisión

El caso debe escalarse inicialmente a:

1. Equipo responsable de Oculus PACS.
2. Equipo de backend/integración DICOM.
3. Equipo de infraestructura y seguridad, para CORS, autenticación y enrutamiento.

Después de confirmar o implementar el endpoint de escritura, el equipo de OHIF podrá realizar la configuración final y, si se mantiene `dicomjson`, la adaptación necesaria para separar lectura y escritura.

## 5. Requisitos para que Oculus PACS acepte DICOM SR

Oculus PACS, directamente o mediante un gateway, debe ofrecer lo siguiente.

### 5.1 Servicio de almacenamiento

- Endpoint DICOMweb **STOW-RS**.
- Soporte para solicitudes HTTP `POST` con instancias DICOM Part 10.
- Soporte para `multipart/related; type="application/dicom"`.
- Respuesta DICOMweb que permita identificar éxito, advertencias o errores por instancia.
- Persistencia real en el archivo, no solamente almacenamiento temporal.

### 5.2 Clases SOP necesarias

Para mediciones generadas por OHIF debe aceptar, como mínimo:

| Objeto | SOP Class | UID |
| --- | --- | --- |
| Comprehensive 3D SR Storage | DICOM SR de mediciones | `1.2.840.10008.5.1.4.1.1.88.34` |

Se recomienda validar también las demás clases SR reconocidas por el visor, pero Comprehensive 3D SR es la principal para el reporte de mediciones de OHIF.

Para conservar además las segmentaciones y contornos:

| Objeto | SOP Class | UID |
| --- | --- | --- |
| Segmentation Storage | DICOM SEG | `1.2.840.10008.5.1.4.1.1.66.4` |
| RT Structure Set Storage | DICOM RTSTRUCT/RTSS | `1.2.840.10008.5.1.4.1.1.481.3` |

### 5.3 Indexación y recuperación

Al recibir un SR/SEG/RTSTRUCT, el PACS debe:

- Conservar el `StudyInstanceUID` del estudio original.
- Registrar la nueva serie y su `SeriesInstanceUID`.
- Registrar la instancia y su `SOPInstanceUID`.
- Preservar las referencias a las imágenes o series originales.
- Exponer la nueva serie mediante QIDO-RS o mediante el JSON consumido por Oculus.
- Permitir recuperar sus metadatos y contenido mediante WADO-RS.

Almacenar el archivo sin indexarlo no es suficiente: OHIF necesita descubrirlo cuando vuelva a consultar el estudio.

### 5.4 Seguridad y red

- Autenticación y autorización para crear objetos derivados.
- Permisos separados, si aplica, para SR, SEG y RTSTRUCT.
- CORS permitido desde el origen web donde se publica OHIF.
- Métodos CORS `OPTIONS` y `POST` habilitados.
- Encabezados `Content-Type`, `Accept` y `Authorization` permitidos.
- HTTPS y certificados válidos.
- Registro de auditoría de usuario, fecha, estudio y objeto almacenado.

### 5.5 Preguntas para el proveedor o equipo de Oculus PACS

1. ¿Oculus PACS dispone de DICOMweb STOW-RS?
2. ¿Cuál es la URL base de STOW-RS?
3. ¿La URL de STOW es la misma que WADO/QIDO o es independiente?
4. ¿Acepta Comprehensive 3D SR Storage?
5. ¿Acepta Segmentation Storage y RT Structure Set Storage?
6. ¿Qué autenticación requiere?
7. ¿Qué roles o permisos necesita el usuario?
8. ¿Las nuevas instancias aparecen inmediatamente en QIDO-RS?
9. Si Oculus genera el DICOM JSON, ¿se actualiza automáticamente después de almacenar una nueva serie?
10. Si no dispone de STOW-RS, ¿acepta C-STORE y puede utilizarse un gateway DICOMweb?

## 6. Configuración recomendada de OHIF

### 6.1 Opción recomendada: DICOMweb para lectura y escritura

La arquitectura más simple y confiable es usar el mismo archivo DICOMweb para:

- QIDO-RS: buscar estudios, series e instancias.
- WADO-RS: recuperar imágenes y objetos derivados.
- STOW-RS: almacenar SR, SEG y RTSTRUCT.

Ejemplo conceptual para OHIF 3.12.5:

```js
window.config = {
  defaultDataSourceName: 'OculusPACS',
  allowMultiSelectExport: false,
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'OculusPACS',
      configuration: {
        friendlyName: 'Oculus PACS DICOMweb',
        name: 'OculusPACS',

        qidoRoot: 'https://pacs.example.com/dicomweb',
        wadoRoot: 'https://pacs.example.com/dicomweb',
        wadoUriRoot: 'https://pacs.example.com/wado',

        supportsStow: true,
        staticWado: false,
        qidoSupportsIncludeField: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        omitQuotationForMultipartRequest: true,
      },
    },
  ],
};
```

Las URLs son ilustrativas y deben reemplazarse por las proporcionadas por Oculus PACS.

#### Consideración para OHIF 3.12.5

En el código analizado, el almacenamiento utiliza el cliente creado a partir de `wadoRoot`. Esta versión no contiene soporte local para configurar un `stowRoot` independiente.

Por tanto, si Oculus expone STOW en una raíz diferente, será necesario uno de estos enfoques:

- Publicar QIDO/WADO/STOW bajo una misma raíz mediante reverse proxy.
- Actualizar OHIF a una versión que permita `stowRoot` separado.
- Incorporar de manera controlada ese soporte en la versión actual.

### 6.2 Opción híbrida: mantener DICOM JSON para lectura

Si por restricciones de Oculus debe mantenerse `dicomjson`, se puede agregar un datasource DICOMweb escribible:

```js
window.config = {
  allowMultiSelectExport: true,
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
      sourceName: 'dicomjson',
      configuration: {
        friendlyName: 'Oculus DICOM JSON',
        name: 'json',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'OculusWrite',
      configuration: {
        friendlyName: 'Oculus PACS - Escritura',
        name: 'OculusWrite',
        qidoRoot: 'https://pacs.example.com/dicomweb',
        wadoRoot: 'https://pacs.example.com/dicomweb',
        supportsStow: true,
        staticWado: false,
      },
    },
  ],
};
```

Con esta alternativa, el usuario tendría que seleccionar `OculusWrite` al crear el reporte o exportar una segmentación.

No obstante, esta configuración por sí sola no garantiza la recarga posterior. También debe cumplirse una de estas condiciones:

- El backend regenera el DICOM JSON e incluye el nuevo SR/SEG/RTSTRUCT.
- OHIF consulta las series derivadas mediante QIDO-RS y las combina con el estudio cargado por JSON.
- Se implementa una capa de integración que delegue `dicomjson.store.dicom()` en el datasource DICOMweb y actualice el descriptor.

Esta opción requiere mayor coordinación y ofrece más puntos de fallo que utilizar DICOMweb de extremo a extremo.

### 6.3 Propiedades que no solucionan el problema por sí solas

- `supportsStow: true`: declara la capacidad, pero no implementa STOW en el servidor.
- `dicomUploadEnabled: true`: habilita la interfaz de carga de archivos, pero no convierte un repositorio estático en PACS.
- `allowMultiSelectExport: true`: permite elegir un destino, pero dicho destino debe ser escribible.
- Mantener `staticWado: true`: no es adecuado para un flujo donde se crean e indexan nuevas instancias dinámicamente.

## 7. Flujo completo cuando Oculus y OHIF estén configurados

### 7.1 Guardado de mediciones como DICOM SR

1. El usuario abre un estudio desde Oculus.
2. OHIF carga las imágenes y sus metadatos.
3. El usuario utiliza herramientas como longitud, ángulo, ROI o anotación.
4. Las mediciones se muestran en el panel derecho y permanecen temporalmente en memoria.
5. El usuario selecciona **Create SR**.
6. OHIF genera un DICOM SR de mediciones, con referencias a las imágenes originales.
7. OHIF serializa el reporte como una instancia DICOM Part 10.
8. OHIF envía el SR mediante STOW-RS al endpoint escribible de Oculus.
9. Oculus valida la clase SOP, permisos, paciente, estudio y referencias.
10. Oculus almacena e indexa el SR como una nueva serie del mismo estudio.
11. Oculus devuelve una respuesta de almacenamiento satisfactoria.
12. OHIF muestra confirmación solamente después de recibir esa respuesta.
13. El usuario puede cerrar el estudio o el navegador.
14. Al volver a abrir el mismo estudio, QIDO-RS o el DICOM JSON actualizado incluye la serie SR.
15. OHIF reconoce el SR y ofrece cargar/hidratar sus mediciones.
16. Al aceptar, OHIF reconstruye las herramientas y vuelve a mostrar las mediciones en el panel derecho y sobre las imágenes correspondientes.

### 7.2 Guardado de segmentaciones

1. El usuario crea una segmentación o contorno.
2. Desde el menú de la segmentación selecciona **Download & Export** y luego la opción de exportación correspondiente.
3. OHIF genera:
   - DICOM SEG para una representación de mapa de etiquetas; o
   - DICOM RTSTRUCT/RTSS para contornos compatibles.
4. OHIF envía el objeto mediante STOW-RS.
5. Oculus lo almacena, indexa y vincula con la serie de imágenes referenciada.
6. Al volver a abrir el estudio, OHIF descubre la serie derivada.
7. El usuario carga o hidrata la segmentación.
8. El panel vuelve a mostrar los segmentos y sus representaciones.

## 8. Diagrama del flujo propuesto

```text
┌──────────────┐
│ Usuario OHIF │
└──────┬───────┘
       │ crea medición o segmentación
       v
┌───────────────────────────┐
│ Estado temporal de OHIF   │
└─────────────┬─────────────┘
              │ Create SR / Export SEG / Export RTSTRUCT
              v
┌───────────────────────────┐
│ Generador DICOM de OHIF   │
└─────────────┬─────────────┘
              │ STOW-RS: POST application/dicom
              v
┌───────────────────────────┐
│ Oculus PACS o gateway     │
│ almacena e indexa         │
└─────────────┬─────────────┘
              │ QIDO-RS / JSON actualizado
              v
┌───────────────────────────┐
│ OHIF reabre el estudio    │
│ y descubre SR/SEG/RTSS    │
└─────────────┬─────────────┘
              │ WADO-RS + hidratación
              v
┌───────────────────────────┐
│ Panel y marcas restauradas│
└───────────────────────────┘
```

## 9. Plan de validación

La solución debe considerarse terminada únicamente cuando se validen los siguientes casos.

### 9.1 Medición/SR

1. Abrir un estudio de prueba.
2. Crear una medición de longitud y una ROI.
3. Guardar con **Create SR**.
4. Verificar en la red del navegador que se realizó un `POST` STOW-RS.
5. Verificar una respuesta satisfactoria del PACS.
6. Consultar el estudio y confirmar una serie con modalidad `SR`.
7. Cerrar completamente el navegador.
8. Abrir nuevamente el estudio.
9. Cargar/hidratar el SR.
10. Confirmar que geometría, etiquetas y valores coinciden con los originales.

### 9.2 Segmentación

1. Crear una segmentación con al menos dos segmentos.
2. Exportar como DICOM SEG.
3. Confirmar el almacenamiento en Oculus.
4. Cerrar y volver a abrir el estudio.
5. Cargar la serie SEG.
6. Confirmar etiquetas, colores, geometría y asociación con la serie original.

### 9.3 Seguridad y errores

- Confirmar que un usuario autorizado puede almacenar.
- Confirmar que un usuario sin permiso recibe un error visible y no una confirmación de éxito.
- Confirmar que una clase SOP rechazada genera un mensaje claro.
- Confirmar que los errores de red no dejan el reporte marcado como persistido.
- Confirmar que el SR/SEG no aparece en un estudio distinto.

## 10. Criterios de aceptación

- El botón **Create SR** produce una solicitud real al PACS.
- Oculus almacena Comprehensive 3D SR.
- El SR aparece en la consulta posterior del mismo estudio.
- Las mediciones se reconstruyen después de cerrar y abrir el navegador.
- DICOM SEG y/o RTSTRUCT siguen el mismo ciclo de almacenamiento y recuperación.
- No se muestra éxito cuando el backend no almacenó la instancia.
- La solución funciona con autenticación y CORS de producción.
- Existe trazabilidad del usuario y de la instancia creada.

## 11. Recomendación final

La recomendación principal es que Oculus PACS publique un servicio DICOMweb completo para los estudios utilizados por OHIF:

```text
QIDO-RS + WADO-RS + STOW-RS
```

OHIF debería utilizar ese datasource para lectura y escritura, eliminando la dependencia de un JSON estático para descubrir objetos derivados.

Si debe mantenerse DICOM JSON, el equipo de Oculus tendrá que garantizar que el descriptor se actualice después de cada almacenamiento, y el equipo OHIF deberá dirigir explícitamente las operaciones de guardado hacia un datasource DICOMweb escribible.

Por tanto, el siguiente paso no es cambiar únicamente una bandera en OHIF: es confirmar con Oculus PACS el endpoint de escritura, las clases SOP admitidas, el método de autenticación y la forma en que las nuevas series se incorporarán a las consultas del estudio.

## 12. Referencias

- OHIF, panel y exportación de mediciones: <https://docs.ohif.org/user-guide/viewer/measurement-panel/>
- OHIF, lectura y escritura de DICOM SR: <https://docs.ohif.org/user-guide/viewer/measurement-tracking/>
- OHIF, configuración de datasources DICOMweb: <https://docs.ohif.org/configuration/datasources/dicom-web/>
- Estándar DICOM PS3.18, servicios DICOMweb: <https://dicom.nema.org/medical/dicom/current/output/html/part18.html>
- Implementación local de DICOM JSON: `extensions/default/src/DicomJSONDataSource/index.js`
- Configuración local de Oculus: `platform/app/public/config/oculus.js`
- Generación y almacenamiento local de SR: `extensions/cornerstone-dicom-sr/src/commandsModule.ts`
- Generación y almacenamiento local de SEG/RTSTRUCT: `extensions/cornerstone-dicom-seg/src/commandsModule.ts`
