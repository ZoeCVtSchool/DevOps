# API REST con pipeline CI/CD a AWS EC2

Proyecto integrador que prueba una API REST, publica su imagen en Docker Hub y, cuando se habilita el despliegue, actualiza una instancia Ubuntu EC2 usando contenedores blue-green y Nginx.

## Arquitectura

`Cliente -> Nginx (puerto 80) -> contenedor activo (puerto 8081 o 8082) -> API Express (3000)`

GitHub Actions ejecuta pruebas y exige al menos 70% de cobertura antes de construir o publicar la imagen. En un `push` a `main`, publica `latest` y el SHA del commit. El despliegue EC2 es opcional hasta crear los secretos y activar la variable de repositorio. La instancia debe tener un Security Group con SSH (22, restringido a la IP del equipo) y HTTP (80, público); no se requiere exponer los puertos 3000, 8081 ni 8082.

> **Alcance de los datos:** esta API educativa conserva los registros en memoria. Los datos se pierden al reiniciar el proceso o contenedor; no es un almacenamiento persistente ni debe recibir datos reales.

## Requisitos locales

- Node.js 22 o superior y npm.
- Docker Desktop para probar la imagen localmente.

## Ejecutar y probar

```powershell
npm ci
npm test
npm start
```

La API escucha en `http://localhost:3000`. `npm test` corre las pruebas de integración con el runner nativo de Node.js y Supertest, y muestra la cobertura de c8; el comando falla si una métrica global queda por debajo del 70%.

Ejemplos de prueba manual:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod -Method Post http://localhost:3000/api/users `
  -ContentType 'application/json' -Body '{"name":"Ada","email":"ada@example.test"}'
Invoke-RestMethod http://localhost:3000/api/users
```

## Endpoints

Hay diez recursos (`users`, `products`, `categories`, `orders`, `customers`, `suppliers`, `inventory`, `carts`, `reviews`, `payments`), cada uno con seis operaciones CRUD:

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/{recurso}` | Lista registros |
| POST | `/api/{recurso}` | Crea un registro (requiere `name` no vacío) |
| GET | `/api/{recurso}/{id}` | Consulta un registro |
| PUT | `/api/{recurso}/{id}` | Reemplaza un registro (requiere `name` no vacío) |
| PATCH | `/api/{recurso}/{id}` | Modifica campos del registro |
| DELETE | `/api/{recurso}/{id}` | Elimina un registro |
| GET | `/api/health` | Verifica el estado de la API |

Los IDs se asignan como cadenas numéricas. Las rutas CRUD suman 60 operaciones distintas, además del health check.

## Docker local

```powershell
docker build -t api-ci-cd:local .
docker run --rm -p 3000:3000 api-ci-cd:local
Invoke-RestMethod http://localhost:3000/api/health
```

## Configuración de GitHub Actions

1. Crea un repositorio nuevo y vacío en GitHub para este proyecto. Luego vincúlalo y publica la rama `main`:

   ```powershell
   git add .
   git commit -m "Initial API CI/CD project"
   git remote add origin https://github.com/<USUARIO>/<REPOSITORIO>.git
   git push -u origin main
   ```

   No reutilices el repositorio de la app Flutter: este proyecto necesita tener `.github/workflows/main.yml` en la raíz del repositorio para que GitHub Actions lo detecte.
2. Crea en Docker Hub un repositorio **público** llamado `api-ci-cd` y un **Personal Access Token** con permiso de lectura y escritura. Al ser público, EC2 puede descargar la imagen sin guardar otra contraseña en el servidor. No uses la contraseña de la cuenta.
3. En **Settings > Secrets and variables > Actions**, configura estos *repository secrets*:

   | Nombre | Valor |
   |---|---|
   | `DOCKERHUB_USERNAME` | Usuario de Docker Hub |
   | `DOCKERHUB_TOKEN` | PAT de Docker Hub |
   | `EC2_HOST` | IP pública o DNS de la instancia |
   | `EC2_USER` | Usuario SSH; normalmente `ubuntu` |
   | `EC2_SSH_KEY` | Contenido íntegro de la clave privada PEM |
   | `EC2_HOST_FINGERPRINT` | Huella SHA-256 de la clave de host SSH de EC2 |

4. Agrega la *repository variable* `ENABLE_EC2_DEPLOY` con valor `true` solamente cuando EC2 esté preparada. Si se omite, CI y publicación Docker siguen funcionando, pero el despliegue se omite.
5. En AWS crea una instancia Ubuntu con IP pública, acceso a Internet saliente y un Security Group que permita TCP 22 solo desde la IP de administración y TCP 80 desde Internet. Copia el script e inicia sesión desde PowerShell (sustituye los valores entre `<...>`):

   ```powershell
   scp -i <RUTA_A_LA_CLAVE.pem> -r .\ec2 ubuntu@<IP_PUBLICA_EC2>:/home/ubuntu/
   ssh -i <RUTA_A_LA_CLAVE.pem> ubuntu@<IP_PUBLICA_EC2>
   ```

   Ya dentro de EC2 ejecuta `sudo bash ~/ec2/bootstrap.sh`. El script instala Docker, Nginx y `curl`; configura Nginx como proxy en el puerto 80 y crea `/opt/api-ci-cd/active-slot`. Ejecútalo como el usuario que GitHub usará por SSH, normalmente `ubuntu`. La instancia necesita salida a Internet para descargar paquetes e imágenes.
6. Registra la huella SSH esperada desde una máquina que tenga OpenSSH:

   ```powershell
   ssh-keyscan -t ed25519 <IP_PUBLICA_EC2> 2>$null | ssh-keygen -lf - -E sha256
   ```

   Copia el valor `SHA256:...` a `EC2_HOST_FINGERPRINT` y comprueba que corresponde a la instancia. La acción de despliegue verifica esa huella antes de autenticar.
7. Usa una rama `main`; un `push` a esta rama publicará `usuario/api-ci-cd:latest` y `usuario/api-ci-cd:<SHA>`. Con `ENABLE_EC2_DEPLOY=true`, Actions inicia el contenedor inactivo, espera que `/api/health` responda, cambia el upstream y recarga Nginx antes de retirar el contenedor previo. El cambio blue-green y la recarga gradual reducen la interrupción; ningún despliegue puede prometer cero fallos de red o de instancia.

### Comprobar la configuración

- En un `pull_request` a `main`: se ejecutan pruebas y cobertura, sin publicar.
- En un `push` a `main`: pruebas; publicación de ambos tags si pasan; despliegue solo si está habilitado.
- Verifica la URL `http://<IP_PUBLICA_EC2>/api/health` y espera `{"status":"ok"}`.

No agregues tokens, contraseñas, direcciones IP, claves `.pem` ni archivos `.env` al repositorio. Los datos privados van en GitHub Secrets; el `.dockerignore` y `.gitignore` excluyen archivos sensibles locales.

## Informe

El archivo [`reporte.tex`](./reporte.tex) contiene el informe LaTeX editable, con portada para completar, introducción, diagramas, resultados de las pruebas locales y fuentes. Para generar el PDF con MiKTeX:

```powershell
pdflatex -interaction=nonstopmode -halt-on-error reporte.tex
pdflatex -interaction=nonstopmode -halt-on-error reporte.tex
```

Antes de entregar, completa los campos de institución, materia, docente, integrantes y grupo; agrega capturas reales del workflow, Docker Hub y EC2 cuando existan. No se incluyen capturas o resultados de infraestructura no ejecutada.
