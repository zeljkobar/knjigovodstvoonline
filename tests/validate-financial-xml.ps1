$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$document = [System.Xml.XmlDocument]::new()
$document.XmlResolver = $null
$document.LoadXml([Console]::In.ReadToEnd())
$schemas = [System.Xml.Schema.XmlSchemaSet]::new()
$schemas.XmlResolver = $null
$null = $schemas.Add('', (Join-Path $PSScriptRoot 'fixtures/financial-statements.xsd'))
$document.Schemas = $schemas
$validationErrors = [System.Collections.Generic.List[string]]::new()
$document.Validate({ param($sender, $event) $validationErrors.Add($event.Message) })
if ($validationErrors.Count -gt 0) {
  $validationErrors | Write-Output
  exit 1
}
Write-Output 'XML is valid against supplied XSD.'
