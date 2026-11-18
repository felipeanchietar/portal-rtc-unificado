# Portal RTC Unificado

Junta as três ferramentas que a Receita Federal publicou para a Reforma Tributária do Consumo (LC 214/2025) numa única tela local.

| Ferramenta | Linguagem / porta | Para que serve |
|---|---|---|
| [calculadora-rtc-regime-regular](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular) | Java 21 · Spring Boot · 8080 | Calcula **CBS, IBS (UF + município) e Imposto Seletivo** por item para empresas do regime geral. Também gera e valida o XML dos grupos de tributação (NF-e, NFC-e, CT-e, BP-e, NF3e; NFS-e só validação), calcula a base unificada e consulta tabelas oficiais (CST, cClassTrib, NCM, NBS, alíquotas). |
| [calculadora-rtc-simples-nacional](https://github.com/ReceitaFederal/calculadora-rtc-simples-nacional) | Java 21 · Spring Boot · 8082 | Calcula **CBS e IBS para quem é do Simples Nacional** (CRT 1/2, ou CRT 3 com apuração "por fora"), segundo a NT 2026.005: receita bruta do item, tpRBSN, alíquotas efetivas, compra governamental e catálogo de atividades (cAtivSN). |
| [calculadora-rtc-gerador-danfse](https://github.com/ReceitaFederal/calculadora-rtc-gerador-danfse) | Go · Echo · 8081 | Recebe o **XML da NFS-e nacional** e devolve o **DANFSe em PDF**, com marca d'água de substituída/cancelada e canhoto opcional. |

## O que o portal acrescenta

```
            navegador ──► http://localhost:8090  (gateway Node, sem dependências)
                              │
          ┌───────────────────┼────────────────────┐
   /svc/regular          /svc/simples          /svc/danfse
   :8080 Java            :8082 Java            :8081 Go
          └──── um único banco SQLite oficial ────┘ (gerado uma vez pelo Flyway)
```

1. **Um só formulário de cálculo.** Você escolhe o CRT do emitente e o portal manda para a calculadora certa.
2. **Do cálculo ao XML.** No regime regular: calcula, gera o grupo de tributação XML e valida no XSD com um clique.
3. **PDF do cálculo.** Gera um demonstrativo em PDF com itens, totais, memória de cálculo e o XML do grupo. O PDF é identificado como simulação e não é documento fiscal.
4. **Da NFS-e ao PDF.** Valida a NFS-e no XSD da calculadora e gera o DANFSe no gerador Go, com o PDF exibido na tela. O gerador exige o XML completo de uma NFS-e já emitida (raiz `<NFSe>`). O XML do grupo exportado pela calculadora não serve para isso.
5. **Consulta reversa NCM/NBS/CST → cClassTrib.** Lista todos os cClassTrib possíveis para um código, com exportação completa em CSV. Veja abaixo.
6. **Consultas num só lugar.** cClassTrib, CST, NCM, NBS, alíquotas de referência, fundamentações, atividades do Simples e códigos de erro REG-/VSN-.

## Consulta reversa (NCM / NBS / CST → cClassTrib)

O gateway lê o mesmo banco SQLite oficial, em modo somente leitura, e aplica a mesma regra de vínculo da calculadora do regime regular (`NcmAplicavelService` / `NbsAplicavelService`):

- **Específicas:** cClassTrib cujo anexo cobre o código por prefixo, respeitando exceções e vigência.
- **Genéricas:** cClassTrib sem anexo vigente cuja nomenclatura admite NCM ou NBS. A calculadora aceita qualquer código para elas.
- **CST:** traz as cClassTrib de CBS/IBS e, em separado, as do Imposto Seletivo que usam o mesmo código de CST.

A regra foi conferida contra a própria calculadora: 112 de 112 combinações NCM × cClassTrib deram o mesmo aceite ou recusa (REG-011). O endpoint oficial `/dados-abertos/classificacoes-tributarias/nbs` só considera o código exato. Por isso ele não retorna, por exemplo, a 200028 (educação) para o NBS 122011200, embora a calculadora aceite esse par pelo prefixo 122011.

Endpoints do gateway:

| Rota | Retorno |
|---|---|
| `GET /reverso?tipo=ncm\|nbs\|cst&codigo=…&data=AAAA-MM-DD` | JSON com `especificas` e `genericas` (ou a lista do CST) |
| `GET /reverso/listagem?tipo=ncm\|nbs\|cst\|genericas&data=AAAA-MM-DD` | CSV completo separado por `;`, que abre direto no Excel |

A pasta [`listagens/`](listagens) traz as listagens prontas para 2027-01-01, geradas a partir da base oficial da data do commit.

Tudo roda localmente. Nenhum dado fiscal sai da máquina.

## Requisitos

- Windows com PowerShell, Git e Node.js 18 ou superior
- JDK 21 ou superior e Go 1.27 ou superior. Se faltarem, o `setup.ps1 -InstalarFerramentas` baixa versões portáteis para `.\tools` (Temurin 21 com ~190 MB e Go com ~80 MB), sem instalar nada no sistema.

## Uso

Rode os comandos de dentro da pasta do projeto, ou use o caminho completo do `.ps1` entre aspas.

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -InstalarFerramentas   # uma vez (clona, gera banco, compila)
powershell -ExecutionPolicy Bypass -File .\start.ps1                         # sobe tudo e abre http://localhost:8090
powershell -ExecutionPolicy Bypass -File .\stop.ps1                          # derruba tudo
```

Para atualizar quando a Receita publicar versões novas (tabelas cClassTrib, alíquotas etc.): `.\setup.ps1 -Atualizar`. O comando faz `git pull`, recria o banco e recompila.

Os logs ficam em `.\logs`. O Swagger original de cada serviço continua disponível:
- http://localhost:8080/api/swagger-ui.html
- http://localhost:8082/api/swagger-ui.html
- http://localhost:8081/api/swagger-ui

## Versão portátil (sem instalar nada)

Para usar em outras máquinas sem Git, Node ou Java:

```powershell
powershell -ExecutionPolicy Bypass -File .\empacotar.ps1      # depois do setup.ps1
```

O comando gera `dist\portal-rtc-portatil-AAAA-MM-DD.zip`, com cerca de 250 MB compactado. O pacote traz:
- um Java 21 reduzido com jlink;
- o `node.exe`;
- os 3 serviços já compilados;
- o banco oficial;
- os atalhos `Iniciar Portal RTC.bat` e `Parar Portal RTC.bat`.

Na outra máquina, basta descompactar e dar dois cliques em **Iniciar Portal RTC**. Requisitos: Windows 10/11 x64 e cerca de 1 GB de RAM livre. O pacote tem mais de 100 MB, então distribua pelo GitHub Releases, Drive ou pendrive, e não pelo repositório.

## Observações

- A partir de 2027, o regime regular exige `aliquotasNominais` em cada item, e o resultado sai como `CALCULO_SIMULADO`. Em 2026, as alíquotas vêm da base oficial e o campo é proibido.
- O README do Simples Nacional manda gerar o banco com os scripts Flyway. Esses scripts estão no repositório do regime regular, porque o banco é o mesmo. O `setup.ps1` gera o banco uma vez e copia para as duas calculadoras.
- O resultado é uma simulação baseada nas ferramentas oficiais e não substitui a apuração.

## Licença

MIT. As ferramentas da Receita Federal (`vendor/`, que não é versionado aqui) têm licença MIT própria, © Receita Federal do Brasil. Este projeto não é oficial e não tem vínculo com a Receita Federal.
