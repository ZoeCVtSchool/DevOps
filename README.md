# API REST con pipeline CI/CD a AWS EC2

Proyecto integrador que prueba una API REST, publica su imagen en Docker Hub y, cuando se habilita el despliegue, actualiza una instancia Ubuntu EC2 mediante AWS Systems Manager (Session Manager/Run Command), GitHub OIDC, contenedores blue-green y Nginx. No se requiere abrir SSH ni guardar una clave PEM en GitHub.

## Arquitectura

`Cliente -> Nginx (puerto 80) -> contenedor activo (puerto 8081 o 8082) -> API Express (3000)`

GitHub Actions ejecuta pruebas y exige al menos 70% de cobertura antes de construir o publicar la imagen. En un `push` a `main`, publica `latest` y el SHA del commit. El despliegue EC2 es opcional hasta configurar AWS OIDC y activar la variable de repositorio. La instancia necesita un Security Group con HTTP (80, público) y salida HTTPS (443); no es necesario abrir SSH (22) para este flujo ni exponer los puertos 3000, 8081 o 8082.

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

1. Crea un repositorio nuevo y vacío en GitHub para este proyecto. Luego configura el remoto correcto y publica la rama `main`:

   ```powershell
   git remote set-url origin https://github.com/<USUARIO>/<REPOSITORIO>.git
   git push -u origin main
   ```

   Este proyecto ya está inicializado y tiene un commit local. Usa `set-url` porque ya puede existir un remoto `origin`. No reutilices el repositorio de la app Flutter: este proyecto necesita tener `.github/workflows/main.yml` en la raíz del repositorio para que GitHub Actions lo detecte.
2. Crea en Docker Hub un repositorio **público** llamado `api-ci-cd` y un **Personal Access Token** con permiso de lectura y escritura. Al ser público, EC2 puede descargar la imagen sin guardar otra contraseña en el servidor. No uses la contraseña de la cuenta.
3. En **Settings > Secrets and variables > Actions**, configura estos *repository secrets*:

   | Nombre | Valor |
   |---|---|
   | `DOCKERHUB_USERNAME` | Usuario de Docker Hub |
   | `DOCKERHUB_TOKEN` | PAT de Docker Hub |

4. Prepara la instancia Ubuntu:

   - Asigna un perfil IAM de instancia con la política administrada `AmazonSSMManagedInstanceCore`.
   - Espera que Systems Manager muestre la instancia como **Online**. Requiere salida HTTPS por 443 a los endpoints de Systems Manager (y salida a Internet para apt/Docker Hub).
   - En **Systems Manager > Run Command**, ejecuta `AWS-RunShellScript` con el contenido de `ec2/bootstrap.sh` para instalar Docker y Nginx y preparar `/opt/api-ci-cd/active-slot`. Alternativamente, abre **Session Manager** y ejecuta el script desde allí. Si el repositorio es público y ya hiciste el push, puedes descargarlo con `curl` desde `https://raw.githubusercontent.com/<USUARIO>/<REPOSITORIO>/main/ec2/bootstrap.sh`.

   El Security Group solo necesita HTTP (80) entrante desde Internet. No abras 22 para este despliegue. La instancia necesita una IP o DNS público para consultar la API desde fuera.
5. Configura GitHub OIDC para que Actions obtenga credenciales temporales de AWS, sin claves AWS estáticas:

   - En IAM, crea el proveedor de identidad OpenID Connect `https://token.actions.githubusercontent.com` con audiencia `sts.amazonaws.com` si aún no existe.
   - Crea un rol IAM de confianza web identity para ese proveedor. Limita el `sub` de la política de confianza al repositorio y rama principal: `repo:<USUARIO>/<REPOSITORIO>:ref:refs/heads/main`. Limita el `aud` a `sts.amazonaws.com`.
   - Adjunta al rol una política con `ssm:SendCommand` únicamente para la instancia objetivo y el documento `AWS-RunShellScript` de la región; concede `ssm:GetCommandInvocation` sobre `*` para consultar el resultado de la orden. No concedas permisos administrativos generales.
   - Copia el ARN del rol (`arn:aws:iam::<ACCOUNT_ID>:role/<ROLE_NAME>`).

6. En **Settings > Secrets and variables > Actions > Variables**, crea estas *repository variables*:

   | Nombre | Valor |
   |---|---|
   | `AWS_REGION` | Región AWS de la instancia, por ejemplo `us-east-2` |
   | `AWS_ROLE_ARN` | ARN del rol IAM limitado a GitHub Actions |
   | `EC2_INSTANCE_ID` | ID de la instancia, por ejemplo `i-0123456789abcdef0` |
   | `ENABLE_EC2_DEPLOY` | `true`, solo cuando la instancia esté Online y preparada |

   Si aún falta preparar la instancia o el rol, no configures `ENABLE_EC2_DEPLOY=true`: pruebas y publicación Docker funcionarán sin desplegar.
7. Haz un `push` a `main`. Actions prueba la API y publica los tags `latest` y `<SHA>` en Docker Hub. Con el despliegue habilitado, asume el rol mediante OIDC, envía `ec2/deploy.sh` usando Systems Manager, espera su resultado, valida la API y cambia Nginx antes de retirar el contenedor anterior.

### Comprobar la configuración

- En un `pull_request` a `main`: se ejecutan pruebas y cobertura, sin publicar.
- En un `push` a `main`: pruebas; publicación de ambos tags si pasan; despliegue solo si está habilitado. Systems Manager debe mostrar la orden como `Success`.
- Verifica la URL `http://<IP_PUBLICA_EC2>/api/health` y espera `{"status":"ok"}`.

No agregues tokens, contraseñas, direcciones IP, claves `.pem` ni archivos `.env` al repositorio. Los datos privados van en GitHub Secrets; el `.dockerignore` y `.gitignore` excluyen archivos sensibles locales.

## Informe

El archivo [`reporte.tex`](./reporte.tex) contiene el informe LaTeX editable, con portada para completar, introducción, diagramas, resultados de las pruebas locales y fuentes. Para generar el PDF con MiKTeX:

```powershell
pdflatex -interaction=nonstopmode -halt-on-error reporte.tex
pdflatex -interaction=nonstopmode -halt-on-error reporte.tex
```

Antes de entregar, completa los campos de institución, materia, docente, integrantes y grupo; agrega capturas reales del workflow, Docker Hub y EC2 cuando existan. No se incluyen capturas o resultados de infraestructura no ejecutada.
