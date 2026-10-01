"""
Validation utilities for data collectors
Provides common validation patterns and error handling
"""

from typing import Any, Dict, List, Optional, TypeVar, Callable
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

T = TypeVar('T')


class ValidationError(Exception):
    """Raised when data validation fails"""
    pass


def validate_required_fields(
    data: Dict[str, Any], 
    required_fields: List[str],
    context: str = ""
) -> None:
    """
    Validate that all required fields are present and not None
    
    Args:
        data: Dictionary to validate
        required_fields: List of required field names
        context: Context string for error messages
        
    Raises:
        ValidationError: If any required field is missing or None
    """
    missing_fields = []
    for field in required_fields:
        if field not in data or data[field] is None:
            missing_fields.append(field)
    
    if missing_fields:
        ctx = f" in {context}" if context else ""
        raise ValidationError(
            f"Missing required fields{ctx}: {', '.join(missing_fields)}"
        )


def safe_get(
    data: Dict[str, Any], 
    *keys: str, 
    default: Any = None,
    validator: Optional[Callable[[Any], bool]] = None
) -> Any:
    """
    Safely get nested value from dictionary with validation
    
    Args:
        data: Source dictionary
        *keys: Path to value (e.g., 'data', 'prices', '0')
        default: Default value if key not found
        validator: Optional function to validate the value
        
    Returns:
        Value at the key path or default
    """
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
        if current is None:
            return default
    
    # Apply validator if provided
    if validator is not None and not validator(current):
        return default
    
    return current


def safe_float(value: Any, default: float = 0.0) -> float:
    """
    Safely convert value to float
    
    Args:
        value: Value to convert
        default: Default if conversion fails
        
    Returns:
        Float value or default
    """
    if value is None:
        return default
    
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def safe_int(value: Any, default: int = 0) -> int:
    """
    Safely convert value to int
    
    Args:
        value: Value to convert
        default: Default if conversion fails
        
    Returns:
        Int value or default
    """
    if value is None:
        return default
    
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def safe_list_access(lst: List[T], index: int, default: Optional[T] = None) -> Optional[T]:
    """
    Safely access list element by index
    
    Args:
        lst: Source list
        index: Index to access (supports negative indices)
        default: Default value if index out of bounds
        
    Returns:
        Element at index or default
    """
    if not isinstance(lst, list) or not lst:
        return default
    
    try:
        return lst[index]
    except IndexError:
        return default


def validate_price_data(data: Dict[str, Any], symbol: str = "") -> bool:
    """
    Validate price/market data
    
    Args:
        data: Price data dictionary
        symbol: Symbol name for logging
        
    Returns:
        True if valid, False otherwise
    """
    try:
        # Check required price fields
        required = ['open', 'high', 'low', 'close', 'volume']
        validate_required_fields(data, required, f"price data for {symbol}")
        
        # Validate price values
        open_price = safe_float(data['open'])
        high_price = safe_float(data['high'])
        low_price = safe_float(data['low'])
        close_price = safe_float(data['close'])
        volume = safe_float(data['volume'])
        
        # Price sanity checks
        if not (0 < open_price < 1e9):
            logger.warning(f"Invalid open price for {symbol}: {open_price}")
            return False
        
        if not (low_price <= high_price):
            logger.warning(f"Invalid price range for {symbol}: low={low_price} high={high_price}")
            return False
        
        if not (low_price <= open_price <= high_price):
            logger.warning(f"Open price out of range for {symbol}: {open_price}")
            return False
        
        if not (low_price <= close_price <= high_price):
            logger.warning(f"Close price out of range for {symbol}: {close_price}")
            return False
        
        if volume < 0:
            logger.warning(f"Negative volume for {symbol}: {volume}")
            return False
        
        return True
        
    except ValidationError as e:
        logger.warning(f"Validation error: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected validation error for {symbol}: {e}")
        return False


def validate_timestamp(
    timestamp: Any, 
    allow_future: bool = False,
    max_age_days: Optional[int] = None
) -> Optional[datetime]:
    """
    Validate and normalize timestamp
    
    Args:
        timestamp: Unix timestamp (seconds or milliseconds), datetime, or ISO string
        allow_future: Whether to allow future timestamps
        max_age_days: Maximum age in days (None for no limit)
        
    Returns:
        Datetime object if valid, None otherwise
    """
    try:
        # Convert to datetime
        if isinstance(timestamp, datetime):
            dt = timestamp
        elif isinstance(timestamp, (int, float)):
            # Handle both seconds and milliseconds
            if timestamp > 1e12:  # Milliseconds
                dt = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
            else:  # Seconds
                dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
        elif isinstance(timestamp, str):
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        else:
            return None
        
        # Ensure timezone aware
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        
        now = datetime.now(timezone.utc)
        
        # Check if future (if not allowed)
        if not allow_future and dt > now:
            logger.warning(f"Future timestamp not allowed: {dt}")
            return None
        
        # Check max age
        if max_age_days is not None:
            age_days = (now - dt).total_seconds() / 86400
            if age_days > max_age_days:
                logger.warning(f"Timestamp too old: {dt} (age: {age_days:.1f} days)")
                return None
        
        return dt
        
    except Exception as e:
        logger.warning(f"Invalid timestamp: {timestamp} - {e}")
        return None


def filter_valid_records(
    records: List[Dict[str, Any]],
    validator: Callable[[Dict[str, Any]], bool],
    log_context: str = ""
) -> List[Dict[str, Any]]:
    """
    Filter list of records keeping only valid ones
    
    Args:
        records: List of records to validate
        validator: Function that returns True if record is valid
        log_context: Context for logging
        
    Returns:
        List of valid records
    """
    valid_records = []
    invalid_count = 0
    
    for record in records:
        try:
            if validator(record):
                valid_records.append(record)
            else:
                invalid_count += 1
        except Exception as e:
            logger.debug(f"Record validation error{' ' + log_context if log_context else ''}: {e}")
            invalid_count += 1
    
    if invalid_count > 0:
        logger.info(
            f"Filtered {invalid_count} invalid records{' from ' + log_context if log_context else ''} "
            f"({len(valid_records)} valid)"
        )
    
    return valid_records


def normalize_symbol(symbol: str) -> str:
    """
    Normalize symbol to standard format
    
    Args:
        symbol: Raw symbol string
        
    Returns:
        Normalized symbol (uppercase, no spaces)
    """
    if not symbol:
        return ""
    return symbol.upper().strip().replace(" ", "")


def validate_percentage(value: Any, min_val: float = -100, max_val: float = 100) -> Optional[float]:
    """
    Validate percentage value
    
    Args:
        value: Value to validate
        min_val: Minimum allowed value
        max_val: Maximum allowed value
        
    Returns:
        Valid percentage or None
    """
    try:
        pct = safe_float(value, None)
        if pct is None:
            return None
        
        if not (min_val <= pct <= max_val):
            logger.warning(f"Percentage out of range: {pct}")
            return None
        
        return pct
    except Exception:
        return None
