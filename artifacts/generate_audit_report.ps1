Set-Location "d:\Projetos\ZiraDesk"

$root = (Get-Location).Path
$lines = Get-Content "artifacts/frontend-client-audit-filtered.txt"

function Suggest-Replacement {
  param(
    [string]$Path,
    [string]$Current,
    [string]$Classification
  )

  if ($Classification -eq "review-status") {
    return "Manter como status/categoria/contrato atual (nao trocar automaticamente para contato/organizacao)."
  }

  if ($Classification -eq "legacy-contract") {
    return "Migrar campo legado client_* para contact_* e remover fallback client_* apos migracao completa do contrato API."
  }

  $s = $Current

  # Keys and identifiers
  $s = $s -replace "tenantAdmin\.dashboard\.stats\.clients", "tenantAdmin.dashboard.stats.organizations"
  $s = $s -replace "'tickets\.fields\.client'", "'tickets.fields.contact'"
  $s = $s -replace "'tickets\.fields\.noClient'", "'tickets.fields.noContact'"
  $s = $s -replace "'tickets\.form\.searchClient'", "'tickets.form.searchContact'"
  $s = $s -replace "'tickets\.form\.noClient'", "'tickets.form.noContact'"
  $s = $s -replace "'form\.client'", "'form.contact'"
  $s = $s -replace "'form\.clientPlaceholder'", "'form.contactPlaceholder'"
  $s = $s -replace "'form\.clientRequired'", "'form.contactRequired'"
  $s = $s -replace "'info\.client'", "'info.contact'"
  $s = $s -replace "CreateClientModal", "CreateContactModal"
  $s = $s -replace "EditClientModal", "EditContactModal"
  $s = $s -replace "\bClientProfile\b", "ContactProfile"
  $s = $s -replace "CrmClientsPage", "CrmContactsPage"
  $s = $s -replace "\bclients\.", "contacts."

  # Text replacements
  $s = $s -replace "\bclientId\b", "contactId"
  $s = $s -replace "\bclient\b", "contact"
  $s = $s -replace "\bClient\b", "Contact"
  $s = $s -replace "\bClients\b", "Contacts"
  $s = $s -replace "\bclients\b", "contacts"
  $s = $s -replace "\bclientes\b", "contatos"
  $s = $s -replace "\bcliente\b", "contato"
  $s = $s -replace "\bClientes\b", "Contatos"
  $s = $s -replace "\bCliente\b", "Contato"

  # Locale-specific admin dashboard label
  if ($Path -like "*locales/en-US/admin.json" -and $Current -match '"clients"\s*:\s*"Clients"') {
    $s = '"organizations": "Organizations",'
  }
  if ($Path -like "*locales/pt-BR/admin.json" -and $Current -match '"clients"\s*:\s*"Clientes"') {
    $s = '"organizations": "Organizacoes",'
  }
  if ($Path -like "*locales/es/admin.json" -and $Current -match '"clients"\s*:\s*"Clientes"') {
    $s = '"organizations": "Organizaciones",'
  }

  if ($s -eq $Current -and $Current -match "client|Client|cliente|Cliente|clients|Clients|clientes|Clientes") {
    return "Renomear referencia de client/cliente para contact/contato (ou organization/organizacao conforme contexto da tela)."
  }

  return $s
}

$rows = foreach ($l in $lines) {
  if ($l -match '^(.*):([0-9]+):(.*)$') {
    $path = $matches[1]
    $line = [int]$matches[2]
    $current = $matches[3].Trim()
    $rel = $path.Replace($root + '\\', '').Replace('\\', '/')

    $classification = "replace"

    $isReviewStatus = (
      $current -match "organizations\.status\.client" -or
      $current -match "\bStatusFilter\b" -or
      $current -match "\bSTATUS_TABS\b" -or
      $current -match "\bOrgStatus\b" -or
      $current -match "sender_type:\s*'agent'\s*\|\s*'client'" -or
      $current -match "status:\s*.*'client'" -or
      ($rel -like "apps/web/src/locales/*/crm.json" -and $current -match '"client"\s*:')
    )

    if ($isReviewStatus) {
      $classification = "review-status"
    }

    if ($current -match "client_id|client_name|client_email|client_phone|client_whatsapp|clientId|crm-client-stats|omnichannel-client-history|\bClientStats\b") {
      if ($classification -ne "review-status") {
        $classification = "legacy-contract"
      }
    }

    $suggested = Suggest-Replacement -Path $rel -Current $current -Classification $classification

    [pscustomobject]@{
      Path = $rel
      Line = $line
      Current = $current
      Suggested = $suggested
      Classification = $classification
    }
  }
}

$out = "artifacts/frontend-b2b-client-audit.md"
$header = @(
  "# Auditoria Frontend B2B - Cliente -> Contato/Organizacao",
  "",
  "Total de ocorrencias filtradas: $($rows.Count)",
  "",
  "| Arquivo | Linha | Texto atual | Substituir por | Classificacao |",
  "|---|---:|---|---|---|"
)

$body = $rows | ForEach-Object {
  $cur = $_.Current.Replace('|', '\\|')
  $sug = $_.Suggested.Replace('|', '\\|')
  "| $($_.Path) | $($_.Line) | $cur | $sug | $($_.Classification) |"
}

($header + $body) | Set-Content -Path $out -Encoding UTF8

"OUT=$out"
"ROWS=$($rows.Count)"
