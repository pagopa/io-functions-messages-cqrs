resource "azurerm_role_assignment" "master_fn_cqrs" {
  scope                = "/subscriptions/ec285037-c673-4f58-b594-d7c480da4e8b/resourceGroups/io-p-backend-messages-rg/providers/Microsoft.Web/sites/io-p-messages-cqrs-fn"
  role_definition_name = "Website Contributor"
  principal_id         = azuread_service_principal.master.object_id
}
