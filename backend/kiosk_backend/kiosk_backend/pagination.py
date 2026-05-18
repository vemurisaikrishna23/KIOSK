from rest_framework.pagination import PageNumberPagination


class KioskPageNumberPagination(PageNumberPagination):
    """
    Default for list endpoints — page size 10, client can request up to 100
    via ?page_size=N. Response shape: { count, next, previous, results }.
    """
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 100
