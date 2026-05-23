from Applications.models import DashboardComponent
for c in DashboardComponent.objects.all().order_by("dashboard_id", "order"):
    cfg = c.config or {}
    layout = cfg.get("layout")
    variant = cfg.get("variant")
    bindings = cfg.get("bindings", [])
    print(
        f"id={c.id} dashboard={c.dashboard_id} name={c.widget_name!r} "
        f"variant={variant!r} layout={layout!r} bindings_count={len(bindings)}"
    )
